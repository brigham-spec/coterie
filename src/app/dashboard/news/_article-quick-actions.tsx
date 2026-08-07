"use client";

import { useState, useTransition } from "react";

import { addNote, addCommitment } from "../companies/[id]/actions";

// Two reuse-driven quick actions shared by the scan-result cards (_news.tsx) and
// the saved-article list (_saved-articles.tsx) — News item 4: log the article as
// a timeline touchpoint (addNote) or open a "we owe" follow-up owned by the
// current user (addCommitment). Both reuse the company-profile server actions
// verbatim (no new write, no migration). Rendered as a fragment so each caller
// controls the surrounding row layout; textClass absorbs the only visual
// divergence (scan cards use a slightly larger label than the denser saved list).
export function ArticleQuickActions({
  companyId,
  headline,
  url,
  currentUserId,
  textClass = "text-[11px]",
}: {
  companyId: string;
  headline: string;
  url: string | null;
  currentUserId: string;
  textClass?: string;
}) {
  const [noteState, setNoteState] = useState<"done" | "error" | null>(null);
  const [isNoting, startNote] = useTransition();
  const [taskState, setTaskState] = useState<"done" | "error" | null>(null);
  const [isTasking, startTask] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={isNoting || noteState === "done"}
        onClick={() =>
          startNote(async () => {
            const f = new FormData();
            f.set("companyId", companyId);
            f.set("body", `News: ${headline}${url ? ` — ${url}` : ""}`);
            const r = await addNote(f);
            setNoteState(r.status === "saved" ? "done" : "error");
          })
        }
        className={`${textClass} text-ink-2 hover:text-gold disabled:opacity-40`}
      >
        {noteState === "done"
          ? "On timeline"
          : isNoting
            ? "Adding…"
            : "+ Timeline"}
      </button>
      <button
        type="button"
        disabled={isTasking || taskState === "done"}
        onClick={() =>
          startTask(async () => {
            const f = new FormData();
            f.set("companyId", companyId);
            f.set("text", `Follow up: ${headline}`);
            f.set("direction", "we_owe");
            f.set("ownerId", currentUserId);
            try {
              await addCommitment(f);
              setTaskState("done");
            } catch {
              setTaskState("error");
            }
          })
        }
        className={`${textClass} text-ink-2 hover:text-gold disabled:opacity-40`}
      >
        {taskState === "done"
          ? "Action added"
          : isTasking
            ? "Adding…"
            : "+ Action item"}
      </button>
      {noteState === "error" ? (
        <span className={`${textClass} text-red-ink`}>
          Couldn&apos;t add to timeline.
        </span>
      ) : null}
      {taskState === "error" ? (
        <span className={`${textClass} text-red-ink`}>
          Couldn&apos;t add action item.
        </span>
      ) : null}
    </>
  );
}
