"use client";

import { useActionState } from "react";

import { Button, Textarea } from "@/components/ui";
import { MAX_LABEL_LENGTH, MAX_TIERS } from "@/lib/member-tiers";

import { updateMemberTiers, type UpdateTiersState } from "./actions";

// Admin editor for the member-tier vocabulary. The write normalizes (trims,
// drops blanks/dupes, caps label + list) server-side, so the box states those
// rules up front and — via useActionState — echoes the normalized result back
// after a save, remounting the textarea on the canonical value so the admin sees
// exactly what was stored rather than discovering it on the next reload.

const initial: UpdateTiersState = { status: "idle" };

export function TiersForm({ tiers }: { tiers: string[] }) {
  const [state, action, saving] = useActionState(updateMemberTiers, initial);

  // After a save the stored (normalized) tiers are authoritative; until then the
  // server-provided list seeds the box.
  const value = state.status === "saved" ? state.tiers : tiers;

  return (
    <form action={action} className="flex flex-col gap-4">
      <Textarea
        // Remount on the saved signature so the box resets to the normalized
        // value once stored (no setState-in-effect).
        key={state.status === "saved" ? state.tiers.join("\u0000") : "initial"}
        name="tiers"
        label="Tiers (one per line)"
        rows={6}
        defaultValue={value.join("\n")}
        placeholder={"Chairman\nDirector\nAdvisory"}
      />
      <p className="text-[11px] text-ink-3">
        One per line, in display order. Up to {MAX_TIERS} tiers,{" "}
        {MAX_LABEL_LENGTH} characters each. Blank and duplicate lines are dropped
        when saved.
      </p>
      <div className="flex items-center justify-between">
        <span className="text-[11px]">
          {state.status === "saved" ? (
            <span className="text-ink-2">
              Saved {state.tiers.length} tier
              {state.tiers.length === 1 ? "" : "s"}.
            </span>
          ) : state.status === "error" ? (
            <span className="text-red-ink">{state.message}</span>
          ) : null}
        </span>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save tiers"}
        </Button>
      </div>
    </form>
  );
}
