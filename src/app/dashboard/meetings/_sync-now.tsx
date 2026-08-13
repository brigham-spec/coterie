"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn, Button } from "@/components/ui";
import { syncCompleted } from "@/lib/sync-status";
import { syncFirefliesNow, readFirefliesSyncProgress } from "./actions";

// "Sync now" feedback (build item 6). The durable Fireflies reconcile runs in a
// background Inngest job, so a fire-and-forget "sync started" told the user
// nothing about progress or when their meetings would appear. This drives real
// completion feedback instead: the start action returns a baseline (last-sync
// clock + meeting count), then we POLL readFirefliesSyncProgress until the job
// advances the clock — reporting elapsed seconds while it runs, the true "N new
// meetings" delta on completion, and finally router.refresh() so those meetings
// actually show up. Two entry points share the hook: the styled Button on the
// Meetings page and the bare compact button in the dashboard sync-status bar.

const POLL_MS = 2500;
// Stop polling after two minutes; the job is durable and keeps running, so this
// is a UI give-up, not a cancel. The message says as much.
const MAX_WAIT_MS = 120_000;

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "syncing"; transcriptCount: number; elapsedS: number }
  | { kind: "complete"; imported: number }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

function useFirefliesSync() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [, startAction] = useTransition();
  // Guards so a poll that resolves after unmount (or after we've given up) is a
  // no-op; the timer ref lets cleanup clear any pending poll.
  const active = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    active.current = false;
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Clear any in-flight poll if the component unmounts mid-sync.
  useEffect(() => stop, [stop]);

  const start = useCallback(() => {
    if (active.current) return;
    active.current = true;
    setPhase({ kind: "starting" });

    startAction(async () => {
      const started = await syncFirefliesNow();
      if (!active.current) return;
      if (started.status === "error") {
        active.current = false;
        setPhase({ kind: "error", message: started.message });
        return;
      }

      const { transcriptCount, sinceMs, baselineMeetingCount } = started;
      const startedAt = Date.now();
      setPhase({ kind: "syncing", transcriptCount, elapsedS: 0 });

      const poll = async () => {
        if (!active.current) return;
        const elapsed = Date.now() - startedAt;
        const progress = await readFirefliesSyncProgress();
        if (!active.current) return;

        if (syncCompleted(sinceMs, progress.lastSyncedMs)) {
          active.current = false;
          const imported = Math.max(
            0,
            progress.firefliesMeetingCount - baselineMeetingCount,
          );
          setPhase({ kind: "complete", imported });
          // The durable job wrote new rows — pull them into the view.
          router.refresh();
          return;
        }

        if (elapsed >= MAX_WAIT_MS) {
          active.current = false;
          setPhase({ kind: "timeout" });
          return;
        }

        setPhase({
          kind: "syncing",
          transcriptCount,
          elapsedS: Math.round(elapsed / 1000),
        });
        timer.current = setTimeout(poll, POLL_MS);
      };

      timer.current = setTimeout(poll, POLL_MS);
    });
  }, [router, startAction]);

  const busy = phase.kind === "starting" || phase.kind === "syncing";
  return { phase, start, busy };
}

function SyncMessage({ phase }: { phase: Phase }) {
  if (phase.kind === "error")
    return <p className="mt-1.5 text-[11px] text-red-ink">{phase.message}</p>;
  if (phase.kind === "syncing")
    return (
      <p className="mt-1.5 text-[11px] text-teal-ink">
        Importing {phase.transcriptCount} transcript
        {phase.transcriptCount === 1 ? "" : "s"}… ({phase.elapsedS}s)
      </p>
    );
  if (phase.kind === "complete")
    return (
      <p className="mt-1.5 text-[11px] text-teal-ink">
        {phase.imported > 0
          ? `Synced — ${phase.imported} new meeting${phase.imported === 1 ? "" : "s"} added.`
          : "Synced — already up to date."}
      </p>
    );
  if (phase.kind === "timeout")
    return (
      <p className="mt-1.5 text-[11px] text-gold-ink">
        Still importing in the background — meetings will appear shortly.
      </p>
    );
  return null;
}

export default function SyncNowButton() {
  const { phase, start, busy } = useFirefliesSync();
  return (
    <div>
      <Button type="button" variant="gold" onClick={start} disabled={busy}>
        {busy ? "Syncing…" : "Sync now"}
      </Button>
      <SyncMessage phase={phase} />
    </div>
  );
}

export function SyncNowButtonCompact({ className }: { className?: string }) {
  const { phase, start, busy } = useFirefliesSync();
  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={cn(className, "disabled:pointer-events-none disabled:opacity-50")}
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
      <SyncMessage phase={phase} />
    </div>
  );
}
