"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader, Field, SelectField } from "@/components/ui";

import { draftIntroEmail, type IntroEmailState } from "./actions";

// Client shell for the draft-introduction-email helper (gap-audit cluster E).
// Holds only view state — the generation runs in the `draftIntroEmail` server
// action, so the Anthropic key never crosses to the browser. The draft is
// ephemeral: it lives in this component's action state and is regenerated on
// demand, never persisted. Pick two contacts (and an optional reason) and the
// host gets a ready-to-edit double-opt-in email.

type ContactOption = { id: string; name: string; org: string };

const initialState: IntroEmailState = { status: "idle" };

export function IntroEmailDraft({ contacts }: { contacts: ContactOption[] }) {
  const [state, formAction, isPending] = useActionState(
    draftIntroEmail,
    initialState,
  );

  return (
    <Card>
      <CardHeader title="Draft an introduction email" />
      <form action={formAction} className="grid grid-cols-2 gap-4 p-4">
        <SelectField
          name="partyAContactId"
          label="Party A — who you're introducing"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Select a contact…
          </option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.org}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="partyBContactId"
          label="Party B — who they're introduced to"
          defaultValue=""
          required
        >
          <option value="" disabled>
            Select a contact…
          </option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.org}
            </option>
          ))}
        </SelectField>
        <Field
          name="context"
          label="Reason / context (optional)"
          className="col-span-2"
          placeholder='e.g. "as a construction partner for the Mill Redevelopment"'
        />
        <div className="col-span-2 flex justify-end">
          <Button type="submit" variant="gold" disabled={isPending}>
            {isPending
              ? "Drafting…"
              : state.status === "ok"
                ? "Redraft email"
                : "Draft email"}
          </Button>
        </div>
      </form>

      {state.status === "error" ? (
        <p className="px-4 pb-4 text-xs text-red-ink">{state.message}</p>
      ) : state.status === "ok" ? (
        <div className="px-4 pb-4">
          {state.draft.subject ? (
            <div className="mb-1 text-[11px] font-medium text-ink-2">
              Subject: {state.draft.subject}
            </div>
          ) : null}
          <p className="rounded-md border border-line bg-surface-2 p-3.5 text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">
            {state.draft.body}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
