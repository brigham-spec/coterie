"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { generateBrief, type BriefState } from "./actions";

// Client shell for the AI brief (build item 5). Holds only view state — the
// generation itself runs in the `generateBrief` server action, so the Anthropic
// key never crosses to the browser. The brief is ephemeral: it lives in this
// component's action state and is regenerated on demand, not persisted.

const initialState: BriefState = { status: "idle" };

export function CompanyBrief({ companyId }: { companyId: string }) {
  const [state, formAction, isPending] = useActionState(
    generateBrief,
    initialState,
  );

  return (
    <Card>
      <CardHeader
        title="AI brief"
        action={
          <form action={formAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <Button type="submit" variant="gold" disabled={isPending}>
              {isPending
                ? "Generating…"
                : state.status === "ok"
                  ? "Regenerate"
                  : "Generate brief"}
            </Button>
          </form>
        }
      />
      <div className="px-4 py-4">
        {state.status === "error" ? (
          <p className="text-xs text-red-ink">{state.message}</p>
        ) : state.status === "ok" ? (
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-2">
            {state.brief}
          </p>
        ) : (
          <p className="text-xs text-ink-3">
            Generate a meeting-ready summary from this company&rsquo;s record,
            contacts, and projects.
          </p>
        )}
      </div>
    </Card>
  );
}
