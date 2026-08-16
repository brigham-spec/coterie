"use client";

import { useActionState } from "react";

import { Button, Card, TagBadge } from "@/components/ui";

import { askSop, type SopAssistantState } from "./actions";

// SOP Assistant UI (knowledge layer, Step 3). A thin client shell over the askSop
// server action (the Anthropic key stays server-side). The staff member types an
// operational question; the answer is grounded strictly in the org's own SOPs and
// cites the doc(s) it drew from. When the SOPs don't cover the question the answer
// says so plainly; when none are on file the empty state points to Settings.

const initialState: SopAssistantState = { status: "idle" };

export function SopAssistant({ sopCount }: { sopCount: number }) {
  const [state, formAction, isPending] = useActionState(askSop, initialState);

  return (
    <div className="mt-4">
      <Card>
        <form action={formAction} className="space-y-3 p-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
              Your question
            </span>
            <textarea
              name="question"
              rows={3}
              placeholder='e.g. "How do we onboard a new member?" or "What is our refund policy?"'
              className="w-full resize-none rounded-sm border border-line-2 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-gold-line"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10.5px] text-ink-3">
              {sopCount === 0
                ? "No SOPs on file yet — add them in Settings."
                : `Grounded in ${sopCount} SOP ${sopCount === 1 ? "document" : "documents"}.`}
            </span>
            <Button type="submit" variant="gold" disabled={isPending}>
              {isPending ? "Searching your SOPs…" : "Ask"}
            </Button>
          </div>
        </form>
      </Card>

      {isPending ? (
        <p className="mt-3 text-[11px] text-ink-3 italic">
          Reading your procedures · composing an answer…
        </p>
      ) : state.status === "error" ? (
        <p className="mt-3 text-[11px] text-red-ink">{state.message}</p>
      ) : state.status === "empty" ? (
        <p className="mt-3 text-[11px] text-ink-3 italic">
          No SOPs are on file. An admin can add procedures under Settings →
          Collateral, then this assistant can answer from them.
        </p>
      ) : state.status === "ok" ? (
        <Answer state={state} />
      ) : null}
    </div>
  );
}

function Answer({
  state,
}: {
  state: Extract<SopAssistantState, { status: "ok" }>;
}) {
  const { answer } = state;
  return (
    <Card className="mt-3">
      <div className="p-4">
        <div className="mb-1 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
          {state.question}
        </div>
        <p className="text-[12.5px] whitespace-pre-wrap text-ink-2">
          {answer.answer}
        </p>
        {answer.answered && answer.citations.length > 0 ? (
          <div className="mt-3 border-t border-line pt-2.5">
            <div className="mb-1.5 text-[9.5px] font-medium tracking-[0.06em] text-ink-3 uppercase">
              From your SOPs
            </div>
            <div className="flex flex-wrap gap-1">
              {answer.citations.map((c) => (
                <TagBadge key={c} label={c} tone="teal" />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
