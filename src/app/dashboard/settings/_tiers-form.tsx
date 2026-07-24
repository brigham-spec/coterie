"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui";
import { MAX_LABEL_LENGTH, MAX_TIERS, type MemberTier } from "@/lib/member-tiers";

import { updateMemberTiers, type UpdateTiersState } from "./actions";

// Admin editor for the member-tier vocabulary. Each row is a label plus an
// optional minimum annual value — the sliding threshold that auto-assigns a
// member's tier from Company.annualValue on save (S7). A blank threshold leaves
// the tier unranked (hand-set only). The write normalizes (trims, drops
// blanks/dupes, caps label + list, coerces thresholds) server-side and echoes
// the stored defs back via useActionState so the admin sees exactly what landed.

const initial: UpdateTiersState = { status: "idle" };

type Row = { label: string; min: string };

function toRows(defs: MemberTier[]): Row[] {
  const rows = defs.map((d) => ({
    label: d.label,
    min: d.minValue === null ? "" : String(d.minValue),
  }));
  // Always leave one empty row so an admin can add without a separate click.
  return rows.length === 0 ? [{ label: "", min: "" }] : rows;
}

export function TiersForm({ tiers }: { tiers: MemberTier[] }) {
  const [state, action, saving] = useActionState(updateMemberTiers, initial);

  // After a save the stored (normalized) defs are authoritative; until then the
  // server-provided list seeds the rows. Key the initial state off the saved
  // signature so the rows reset to canonical once stored (no setState-in-effect).
  const source = state.status === "saved" ? state.tiers : tiers;
  const [rows, setRows] = useState<Row[]>(() => toRows(source));
  const [signature, setSignature] = useState(() => sig(source));
  const nextSig = sig(source);
  if (nextSig !== signature) {
    setSignature(nextSig);
    setRows(toRows(source));
  }

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const add = () =>
    setRows((rs) => (rs.length >= MAX_TIERS ? rs : [...rs, { label: "", min: "" }]));

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-[1fr_10rem_2rem] gap-2 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
          <span>Tier label</span>
          <span>Min annual value ($)</span>
          <span />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_10rem_2rem] items-center gap-2">
            <input
              name="label"
              value={row.label}
              onChange={(e) => update(i, { label: e.currentTarget.value })}
              maxLength={MAX_LABEL_LENGTH}
              placeholder="Director"
              className="w-full rounded border border-line bg-transparent px-2 py-1.5 text-xs text-ink"
            />
            <input
              name="minValue"
              value={row.min}
              onChange={(e) => update(i, { min: e.currentTarget.value })}
              type="number"
              min={0}
              step={1}
              placeholder="unranked"
              className="w-full rounded border border-line bg-transparent px-2 py-1.5 text-xs text-ink"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
              aria-label="Remove tier"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={add}
          disabled={rows.length >= MAX_TIERS}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:opacity-40"
        >
          Add tier
        </button>
      </div>

      <p className="text-[11px] text-ink-3">
        In display order, from top. Up to {MAX_TIERS} tiers, {MAX_LABEL_LENGTH}{" "}
        characters each. A member is auto-assigned the highest tier whose minimum
        its annual value clears; leave the minimum blank to keep a tier unranked
        (hand-set only). Blank and duplicate labels are dropped when saved.
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

// Stable signature of a def list for reset detection (label + threshold).
function sig(defs: MemberTier[]): string {
  return defs.map((d) => `${d.label}\u0000${d.minValue ?? ""}`).join("\u0001");
}
