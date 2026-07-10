"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { generateWhyJoin, type WhyJoinState } from "./actions";

// Client shell for the why-join membership pitch (gap-audit cluster E). Holds only
// view state — the generation runs in the `generateWhyJoin` server action, so the
// Anthropic key never crosses to the browser. The pitch is ephemeral: it lives in
// this component's action state and is regenerated on demand, never persisted.
// Rendered only for prospects (the pitch makes the case for joining).

const initialState: WhyJoinState = { status: "idle" };

function Section({ title, body }: { title: string; body: string }) {
  if (body.trim() === "") return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
        {title}
      </div>
      <p className="text-xs leading-relaxed text-ink-2">{body}</p>
    </div>
  );
}

export function WhyJoin({ companyId }: { companyId: string }) {
  const [state, formAction, isPending] = useActionState(
    generateWhyJoin,
    initialState,
  );

  return (
    <Card>
      <CardHeader
        title="Why join?"
        action={
          <form action={formAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <Button type="submit" variant="gold" disabled={isPending}>
              {isPending
                ? "Writing…"
                : state.status === "ok"
                  ? "Rewrite"
                  : "Make the case"}
            </Button>
          </form>
        }
      />
      <div className="px-4 py-4">
        {state.status === "error" ? (
          <p className="text-xs text-red-600">{state.message}</p>
        ) : state.status === "ok" ? (
          <div className="flex flex-col gap-4">
            {state.pitch.headline ? (
              <div className="rounded-md border border-gold-line bg-gold-bg px-3.5 py-3 text-[13px] font-semibold text-gold">
                {state.pitch.headline}
              </div>
            ) : null}
            <Section title="Network value" body={state.pitch.networkValue} />
            <Section title="Track record in this sector" body={state.pitch.trackRecord} />
            <Section title="Immediate opportunities" body={state.pitch.openRoles} />
            <Section title="Their position in the network" body={state.pitch.industryPosition} />
            {state.pitch.topIntros.length > 0 ? (
              <div>
                <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                  Day-one introductions
                </div>
                <div className="flex flex-col gap-2">
                  {state.pitch.topIntros.map((intro, idx) => (
                    <div
                      key={idx}
                      className="rounded-sm border border-line px-3 py-2"
                    >
                      <div className="text-xs font-medium text-ink">
                        {intro.name}
                        {intro.org ? (
                          <span className="text-ink-3"> — {intro.org}</span>
                        ) : null}
                      </div>
                      {intro.reason ? (
                        <div className="mt-0.5 text-[11px] text-ink-3">
                          {intro.reason}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {state.pitch.emailBody ? (
              <div>
                <div className="mb-1 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                  Outreach email draft
                </div>
                {state.pitch.emailSubject ? (
                  <div className="mb-1 text-[11px] font-medium text-ink-2">
                    Subject: {state.pitch.emailSubject}
                  </div>
                ) : null}
                <p className="rounded-md border border-line bg-surface-2 p-3.5 text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
                  {state.pitch.emailBody}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-ink-3">
            Build a specific, grounded case for why this prospect should join —
            the members they&apos;d meet, the network&apos;s track record in their
            sector, and a ready-to-edit outreach email.
          </p>
        )}
      </div>
    </Card>
  );
}
