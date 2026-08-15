"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui";
import {
  MAX_NAME_LENGTH,
  MAX_PACKAGES,
  MAX_SUMMARY_LENGTH,
  type MembershipPackage,
} from "@/lib/membership-packages";

import { updateMembershipPackages, type UpdatePackagesState } from "./actions";

// Admin editor for the org's membership packages — the sellable offerings
// (name, optional annual price, positioning line, included services) that
// proposals and the generators draw on. Services are edited as a plain textarea,
// one per line. The write normalizes server-side (drops blank-name rows, coerces
// prices, cleans service bullets, caps everything) and echoes the stored
// packages back via useActionState so the admin sees exactly what landed.

const initial: UpdatePackagesState = { status: "idle" };

type Row = {
  name: string;
  price: string;
  summary: string;
  services: string;
};

function toRows(packages: MembershipPackage[]): Row[] {
  const rows = packages.map((p) => ({
    name: p.name,
    price: p.annualPrice === null ? "" : String(p.annualPrice),
    summary: p.summary,
    services: p.includedServices.join("\n"),
  }));
  // Always leave one empty row so an admin can add without a separate click.
  return rows.length === 0
    ? [{ name: "", price: "", summary: "", services: "" }]
    : rows;
}

export function PackagesForm({ packages }: { packages: MembershipPackage[] }) {
  const [state, action, saving] = useActionState(
    updateMembershipPackages,
    initial,
  );

  // After a save the stored (normalized) packages are authoritative; until then
  // the server-provided list seeds the rows. Key off the saved signature so the
  // rows reset to canonical once stored (no setState-in-effect).
  const source = state.status === "saved" ? state.packages : packages;
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
    setRows((rs) =>
      rs.length >= MAX_PACKAGES
        ? rs
        : [...rs, { name: "", price: "", summary: "", services: "" }],
    );

  const inputCls =
    "w-full rounded border border-line bg-transparent px-2 py-1.5 text-xs text-ink";

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded border border-line p-3"
          >
            <div className="grid grid-cols-[1fr_10rem_2rem] items-center gap-2">
              <input
                name="name"
                value={row.name}
                onChange={(e) => update(i, { name: e.currentTarget.value })}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Chairman's Circle"
                className={inputCls}
              />
              <input
                name="price"
                value={row.price}
                onChange={(e) => update(i, { price: e.currentTarget.value })}
                type="number"
                min={0}
                step={1}
                placeholder="Annual $ (blank = custom)"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
                aria-label="Remove package"
              >
                ×
              </button>
            </div>
            <input
              name="summary"
              value={row.summary}
              onChange={(e) => update(i, { summary: e.currentTarget.value })}
              maxLength={MAX_SUMMARY_LENGTH}
              placeholder="One-line positioning (optional)"
              className={inputCls}
            />
            <textarea
              name="services"
              value={row.services}
              onChange={(e) => update(i, { services: e.currentTarget.value })}
              rows={3}
              placeholder="Included services, one per line"
              className={`${inputCls} resize-y`}
            />
          </div>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={add}
          disabled={rows.length >= MAX_PACKAGES}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline disabled:opacity-40"
        >
          Add package
        </button>
      </div>

      <p className="text-[11px] text-ink-3">
        In display order, from top. Up to {MAX_PACKAGES} packages. Leave the price
        blank for custom / on-request pricing. List each included service on its
        own line. Blank-name packages are dropped when saved.
      </p>

      <div className="flex items-center justify-between">
        <span className="text-[11px]">
          {state.status === "saved" ? (
            <span className="text-ink-2">
              Saved {state.packages.length} package
              {state.packages.length === 1 ? "" : "s"}.
            </span>
          ) : state.status === "error" ? (
            <span className="text-red-ink">{state.message}</span>
          ) : null}
        </span>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save packages"}
        </Button>
      </div>
    </form>
  );
}

// Stable signature of a package list for reset detection.
function sig(packages: MembershipPackage[]): string {
  return packages
    .map(
      (p) =>
        `${p.name}\u0000${p.annualPrice ?? ""}\u0000${p.summary}\u0000${p.includedServices.join("\u0002")}`,
    )
    .join("\u0001");
}
