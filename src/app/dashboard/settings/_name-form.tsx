"use client";

import { useActionState } from "react";

import { Button, Field } from "@/components/ui";

import { updateDisplayName, type UpdateNameState } from "./actions";

// Self-service editor for the signed-in user's recognized display name — the
// label shown as owner, actor, greeting, and in staff pickers. Seeded from Clerk
// on first sign-in, then user-owned. Keyed off the saved name via useActionState
// so the field reflects exactly what was stored.

const initial: UpdateNameState = { status: "idle" };

export function NameForm({
  currentName,
  email,
}: {
  currentName: string;
  email: string;
}) {
  const [state, action, saving] = useActionState(updateDisplayName, initial);
  const value = state.status === "saved" ? state.name : currentName;

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        // Remount on save so defaultValue re-seeds from the stored name.
        key={value}
        label="Display name"
        name="name"
        defaultValue={value}
        maxLength={80}
        placeholder="e.g. Sarah Lee"
        autoComplete="name"
      />

      <p className="text-[11px] text-ink-3">
        This is how you appear across the tool — as an owner, on activity, and in
        the greeting. Signed in as {email}.
      </p>

      <div className="flex items-center justify-between">
        <span className="text-[11px]">
          {state.status === "saved" ? (
            <span className="text-ink-2">Saved.</span>
          ) : state.status === "error" ? (
            <span className="text-red-ink">{state.message}</span>
          ) : null}
        </span>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save name"}
        </Button>
      </div>
    </form>
  );
}
