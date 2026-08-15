"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button, TagBadge } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";

import { generateMeetingPrepAction, type MeetingPrepState } from "./actions";

// Client shell for the pre-meeting brief (gap-audit cluster A). Holds only view
// state — the generation runs in the `generateMeetingPrepAction` server action, so
// the Anthropic key never crosses to the browser. The brief is ephemeral: it lives
// in this component's action state and is regenerated on demand, never persisted.
//
// INTEGRITY: only `brief.narrative` and each intro `reason` are the model's words.
// The fact sections (last meeting, open action items, news, value) come VERBATIM
// from `sections` (DB-sourced), so nothing rendered as fact is a paraphrase.

const initialState: MeetingPrepState = { status: "idle" };

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Small uppercase eyebrow for each verbatim fact section.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase">
      {children}
    </p>
  );
}

export function MeetingPrep({ companyId }: { companyId: string }) {
  const [state, formAction, isPending] = useActionState(
    generateMeetingPrepAction,
    initialState,
  );

  return (
    <CollapsibleCard
      id="company-meeting-prep"
      title="Meeting prep"
      action={
        <form action={formAction}>
          <input type="hidden" name="companyId" value={companyId} />
          <Button type="submit" variant="gold" disabled={isPending}>
            {isPending
              ? "Preparing…"
              : state.status === "ok"
                ? "Refresh"
                : "Prep me"}
          </Button>
        </form>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {state.status === "error" ? (
          <p className="text-xs text-red-ink">{state.message}</p>
        ) : state.status === "ok" ? (
          <>
            <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-2 italic">
              {state.brief.narrative}
            </p>

            {state.sections.lastMeeting ? (
              <div className="flex flex-col gap-1">
                <SectionLabel>Where things left off</SectionLabel>
                <p className="text-xs text-ink-2">
                  {state.sections.lastMeeting.title}
                  <span className="text-ink-3">
                    {" · "}
                    {state.sections.lastMeeting.heldAt}
                  </span>
                </p>
              </div>
            ) : null}

            {state.sections.actionItems.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <SectionLabel>Outstanding action items</SectionLabel>
                <ul className="flex flex-col gap-1.5">
                  {state.sections.actionItems.map((it, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <TagBadge
                        label={it.owedBy === "us" ? "we owe" : "they owe"}
                        tone={it.owedBy === "us" ? "gold" : "slate"}
                      />
                      <span className="text-ink-2">{it.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {state.brief.introRecommendations.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <SectionLabel>Introductions to make</SectionLabel>
                <ul className="flex flex-col gap-1.5">
                  {state.brief.introRecommendations.map((rec) => (
                    <li key={rec.companyId} className="text-xs">
                      <Link
                        href={`/dashboard/companies/${rec.companyId}`}
                        className="font-medium text-gold hover:underline"
                      >
                        {rec.companyName}
                      </Link>
                      {rec.reason ? (
                        <span className="text-ink-2"> — {rec.reason}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {state.sections.news.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <SectionLabel>News to mention</SectionLabel>
                <ul className="flex flex-col gap-1">
                  {state.sections.news.map((n, i) => (
                    <li key={i} className="text-xs">
                      {n.url ? (
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-2 hover:underline"
                        >
                          {n.headline}
                        </a>
                      ) : (
                        <span className="text-ink-2">{n.headline}</span>
                      )}
                      <span className="text-ink-3">{" · "}{n.capturedAt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-col gap-1">
              <SectionLabel>Value delivered so far</SectionLabel>
              {state.sections.value.entryCount > 0 ? (
                <p className="text-xs text-ink-2">
                  <strong className="text-ink">
                    {state.sections.value.totalAmount > 0
                      ? currency.format(state.sections.value.totalAmount)
                      : state.sections.value.entryCount}
                  </strong>{" "}
                  {state.sections.value.totalAmount > 0
                    ? `across ${state.sections.value.entryCount} win${state.sections.value.entryCount === 1 ? "" : "s"}`
                    : `win${state.sections.value.entryCount === 1 ? "" : "s"} delivered through the network`}
                </p>
              ) : (
                <p className="text-xs text-ink-3">No value logged yet.</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-ink-3">
            Get a robust brief before your next meeting — where things left off,
            open action items, introductions worth making, recent news, and the
            value delivered so far.
          </p>
        )}
      </div>
    </CollapsibleCard>
  );
}
