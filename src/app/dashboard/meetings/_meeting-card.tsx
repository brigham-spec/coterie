"use client";

import { useState, type ReactNode } from "react";

import { Card } from "@/components/ui";
import type { MeetingMember, MeetingSource } from "@/lib/meetings-view";

// A meeting card that collapses to a preview (parity: Meet 9/10). The header,
// source badge, and member tags always show; the full summary plus the attendee
// and action-item detail (passed as children so their server-action forms stay
// server-rendered) expand on demand. Collapsed shows a two-sentence preview.

export function MeetingCard({
  title,
  dateLabel,
  durationMinutes,
  location,
  transcriptUrl,
  source,
  members,
  summary,
  preview,
  defaultOpen = false,
  children,
}: {
  title: string;
  dateLabel: string;
  durationMinutes: number | null;
  location: string | null;
  transcriptUrl: string | null;
  source: MeetingSource;
  members: MeetingMember[];
  summary: string | null;
  preview: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-[1.1rem] py-2.5">
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">
          {title}
        </span>
        <span className="flex flex-shrink-0 items-center gap-2 text-[11px] text-ink-3">
          <span
            className={
              source === "fireflies"
                ? "rounded-full bg-gold-bg px-2 py-0.5 text-[10px] font-medium text-gold-ink"
                : "rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-ink-2"
            }
          >
            {source === "fireflies" ? "Fireflies" : "Manual"}
          </span>
          {dateLabel}
          {durationMinutes != null ? <>{" · "}{durationMinutes} min</> : null}
          {location ? <>{" · "}{location}</> : null}
          {transcriptUrl != null ? (
            <>
              {" · "}
              <a
                href={transcriptUrl}
                target="_blank"
                rel="noreferrer"
                className="text-gold underline"
              >
                transcript
              </a>
            </>
          ) : null}
        </span>
      </div>

      <div className="px-4 py-4">
        {members.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {members.map((m) => (
              <span
                key={m.id}
                className="rounded-full bg-teal-bg px-2 py-0.5 text-[10px] font-medium text-teal-ink"
              >
                {m.name}
              </span>
            ))}
          </div>
        ) : null}

        {open ? (
          <>
            {summary != null && summary !== "" ? (
              <p className="mb-4 text-xs leading-relaxed whitespace-pre-wrap text-ink-2">
                {summary}
              </p>
            ) : null}
            {children}
          </>
        ) : preview !== "" ? (
          <p className="text-xs leading-relaxed text-ink-3">{preview}</p>
        ) : (
          <p className="text-xs text-ink-3 italic">No summary.</p>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-3 text-[11px] font-medium text-gold hover:underline"
        >
          {open ? "Hide details" : "Show details"}
        </button>
      </div>
    </Card>
  );
}
