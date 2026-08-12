"use client";

import { useActionState } from "react";

import { Button, cn } from "@/components/ui";
import { syncFirefliesNow, type SyncNowState } from "./actions";

// "Sync now" feedback (build item 6). The action does a synchronous Fireflies
// preflight, so the user gets an immediate signal: `pending` drives a loading
// label while the request is in flight, and the resolved state renders either a
// specific error or a "sync started — N transcripts" confirmation. Two entry
// points share the same action + message: the styled Button on the Meetings page
// and the bare compact button in the dashboard sync-status bar.

const INITIAL: SyncNowState = { status: "idle" };

function Message({ state }: { state: SyncNowState }) {
  if (state.status === "error")
    return <p className="mt-1.5 text-[11px] text-red-ink">{state.message}</p>;
  if (state.status === "started")
    return (
      <p className="mt-1.5 text-[11px] text-teal-ink">
        Sync started — {state.transcriptCount} recent transcript
        {state.transcriptCount === 1 ? "" : "s"} found. Meetings appear shortly.
      </p>
    );
  return null;
}

export default function SyncNowButton() {
  const [state, action, pending] = useActionState(syncFirefliesNow, INITIAL);
  return (
    <form action={action}>
      <Button type="submit" variant="gold" disabled={pending}>
        {pending ? "Syncing…" : "Sync now"}
      </Button>
      <Message state={state} />
    </form>
  );
}

export function SyncNowButtonCompact({ className }: { className?: string }) {
  const [state, action, pending] = useActionState(syncFirefliesNow, INITIAL);
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className={cn(className, "disabled:pointer-events-none disabled:opacity-50")}
      >
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <Message state={state} />
    </form>
  );
}
