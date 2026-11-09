"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui";

import { createIntroduction } from "./actions";
import { dismissIntro } from "../companies/[id]/actions";
import { INTRO_DISMISS_REASONS } from "@/lib/intro-dismissal";

// The "New intro opportunities" panel on the Introductions page (co-attendance
// discovery — two member companies in the same room with no intro on record). A
// client shell over the server-rendered candidates so each pairing can be acted
// on four ways: MAKE it (createIntroduction, optionally with a COMMENT saved onto
// the intro's notes), IGNORE it with a specific reason, or DELETE it (a one-click
// quick-dismiss). A disposition is optimistically hidden here and persisted via
// dismissIntro; the same pair is then folded into the discovery suppression set,
// so it won't resurface on the next load. A failed write simply reappears on the
// next reload.
//
// The whole panel collapses behind its gold header (native <details>) because the
// worklist can run up to a dozen candidates; the open/closed choice persists in
// localStorage so it survives navigation.

// One candidate reduced to plain serializable props (the server pre-formats the
// meeting date into meetingLabel so this stays a client component with no Dates).
export type NewIntroCandidateView = {
  companyAId: string;
  companyAName: string;
  contactAId: string;
  contactAName: string;
  companyBId: string;
  companyBName: string;
  contactBId: string;
  contactBName: string;
  meetingTitle: string;
  meetingLabel: string;
};

const pairKey = (c: NewIntroCandidateView) => `${c.companyAId}|${c.companyBId}`;

// useLayoutEffect before paint (so a saved-collapsed panel never flashes open)
// but is a no-op that warns on the server; fall back to useEffect during SSR.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const STORAGE_KEY = "coterie:card:new-intro-opportunities";

export function NewIntroOpportunities({
  candidates,
}: {
  candidates: NewIntroCandidateView[];
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // Apply the remembered open/closed state before paint (SSR renders open).
  useIsomorphicLayoutEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved != null && detailsRef.current)
      detailsRef.current.open = saved === "1";
  }, []);

  const visible = candidates.filter((c) => !dismissed.has(pairKey(c)));
  if (visible.length === 0) return null;

  return (
    <details
      ref={detailsRef}
      open
      onToggle={(e) =>
        window.localStorage.setItem(
          STORAGE_KEY,
          e.currentTarget.open ? "1" : "0",
        )
      }
      className="group/ni mb-4 overflow-hidden rounded-md border border-gold-line bg-surface shadow-card"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-line bg-gold-bg/40 px-4 py-2.5 select-none [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className="size-3 shrink-0 text-gold-ink/70 transition-transform group-open/ni:rotate-90"
        >
          <path
            d="M6 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-[10px] font-medium tracking-[0.07em] text-gold-ink uppercase">
          New intro opportunities
        </span>
        <span className="text-[10px] text-gold-ink/70">
          {visible.length} from recent meetings
        </span>
      </summary>
      <div className="divide-y divide-line">
        {visible.map((c) => (
          <CandidateRow
            key={pairKey(c)}
            c={c}
            onDismiss={(key) => setDismissed((prev) => new Set(prev).add(key))}
          />
        ))}
      </div>
    </details>
  );
}

function CandidateRow({
  c,
  onDismiss,
}: {
  c: NewIntroCandidateView;
  onDismiss: (key: string) => void;
}): ReactNode {
  const [isDismissing, startDismiss] = useTransition();
  // The comment field is revealed on demand; collapsed by default so the row
  // stays compact. When open it submits as the intro's `notes` on Log intro.
  const [noteOpen, setNoteOpen] = useState(false);

  function dispose(reason: string) {
    // Optimistically hide, then persist. A failed write just reappears on the
    // next reload (which re-queries and already excludes it).
    onDismiss(pairKey(c));
    startDismiss(async () => {
      await dismissIntro(c.companyAId, c.companyBId, reason);
    });
  }

  // The whole row is the Log-intro form so an optional comment (`notes`) rides
  // along on submit. The ignore/delete controls are type="button" (they never
  // submit the form) — they optimistically dismiss the pair instead.
  return (
    <form action={createIntroduction} className="px-4 py-2.5">
      <input type="hidden" name="partyAContactId" value={c.contactAId} />
      <input type="hidden" name="partyBContactId" value={c.contactBId} />
      <input type="hidden" name="status" value="suggested" />
      <input type="hidden" name="headline" value={`Met at ${c.meetingTitle}`} />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[11.5px] text-ink">
            {c.contactAName}{" "}
            <span className="text-ink-3">({c.companyAName})</span>{" "}
            <span className="text-ink-3">&#8596;</span> {c.contactBName}{" "}
            <span className="text-ink-3">({c.companyBName})</span>
          </div>
          <div className="truncate text-[10px] text-ink-3">
            Met at {c.meetingTitle} &middot; {c.meetingLabel}
          </div>
        </div>
        <Button type="submit" variant="primary" className="flex-shrink-0">
          Log intro
        </Button>
      </div>
      {noteOpen ? (
        <textarea
          name="notes"
          rows={2}
          maxLength={1000}
          placeholder="Add a comment (saved to the intro's notes)…"
          className="mt-2 w-full rounded-sm border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-gold-line"
        />
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          className="text-[10px] text-ink-3 hover:text-ink-2 hover:underline"
        >
          {noteOpen ? "Hide comment" : "Comment"}
        </button>
        <span className="text-[9.5px] text-ink-3">Ignore as</span>
        {INTRO_DISMISS_REASONS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => dispose(r.value)}
            disabled={isDismissing}
            className="text-[10px] text-ink-3 hover:text-ink-2 hover:underline disabled:opacity-50"
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => dispose("not_relevant")}
          disabled={isDismissing}
          className="text-[10px] font-medium text-red hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </form>
  );
}
