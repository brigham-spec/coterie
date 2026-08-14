"use client";

import { useState, useTransition, type ReactNode } from "react";

import { getTagDef, ORG_TAGS } from "@/lib/tags";
import { TagBadge, cn } from "@/components/ui";

import {
  setCompanyOwner,
  setCompanyTags,
  setCompanyTier,
  setCompanyValue,
} from "./actions";

// Inline quick-edit cells for the companies list. Each cell shows its value as a
// clickable button; clicking swaps in a compact editor that commits to the
// matching single-field server action and, on Next.js revalidation, re-renders
// the row with the saved value. The display markup mirrors the list's static
// cells so the table looks identical until you click into a cell.

// The editor control (select/input) — a focused, gold-ringed compact field.
const editControl =
  "w-full rounded-sm border border-gold-line bg-surface px-1.5 py-1 text-xs text-ink outline-none ring-2 ring-gold-line/20";

// The display button — blends into the table, hints clickability on hover, dims
// while a save is in flight.
function CellButton({
  children,
  onClick,
  pending,
}: {
  children: ReactNode;
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        "-mx-1.5 w-[calc(100%+0.75rem)] rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-surface-3",
        pending && "opacity-50",
      )}
    >
      {children}
    </button>
  );
}

export function OwnerCell({
  companyId,
  ownerUserId,
  ownerName,
  staff,
}: {
  companyId: string;
  ownerUserId: string | null;
  ownerName: string | null;
  staff: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <CellButton pending={pending} onClick={() => setEditing(true)}>
        {ownerName ?? <span className="text-ink-3">—</span>}
      </CellButton>
    );
  }

  return (
    <select
      autoFocus
      defaultValue={ownerUserId ?? ""}
      className={editControl}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        const value = e.currentTarget.value;
        setEditing(false);
        if (value === (ownerUserId ?? "")) return;
        const fd = new FormData();
        fd.set("companyId", companyId);
        fd.set("ownerUserId", value);
        start(() => setCompanyOwner(fd));
      }}
    >
      <option value="">Unassigned</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

export function TierCell({
  companyId,
  tier,
  tiers,
}: {
  companyId: string;
  tier: string | null;
  tiers: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <CellButton pending={pending} onClick={() => setEditing(true)}>
        {tier ?? <span className="text-ink-3">—</span>}
      </CellButton>
    );
  }

  // Keep a legacy tier value (no longer in the configured list) selectable so it
  // isn't silently dropped from the menu.
  const options = tier && !tiers.includes(tier) ? [tier, ...tiers] : tiers;

  return (
    <select
      autoFocus
      defaultValue={tier ?? ""}
      className={editControl}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        const value = e.currentTarget.value;
        setEditing(false);
        if (value === (tier ?? "")) return;
        const fd = new FormData();
        fd.set("companyId", companyId);
        fd.set("tier", value);
        start(() => setCompanyTier(fd));
      }}
    >
      <option value="">—</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

export function TagsCell({
  companyId,
  tags,
}: {
  companyId: string;
  tags: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <CellButton pending={pending} onClick={() => setEditing(true)}>
        {tags.length === 0 ? (
          <span className="text-ink-3">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 3).map((key) => {
              const def = getTagDef(key);
              return (
                <TagBadge
                  key={key}
                  label={def.label}
                  tone={def.tone}
                  title={def.desc}
                />
              );
            })}
            {tags.length > 3 ? (
              <span className="text-[10px] text-ink-3">+{tags.length - 3}</span>
            ) : null}
          </div>
        )}
      </CellButton>
    );
  }

  return (
    <form
      action={(fd) => {
        setEditing(false);
        const next = fd.getAll("networkTags").map(String);
        // Skip a no-op save (same set of tags, order-independent).
        if (next.length === tags.length && next.every((t) => tags.includes(t)))
          return;
        fd.set("companyId", companyId);
        start(() => setCompanyTags(fd));
      }}
      className="w-56 rounded-md border border-line bg-surface p-2 shadow-pop"
    >
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {ORG_TAGS.map((t) => (
          <label
            key={t.key}
            className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-[11px] text-ink hover:bg-surface-2"
          >
            <input
              type="checkbox"
              name="networkTags"
              value={t.key}
              defaultChecked={tags.includes(t.key)}
            />
            {t.label}
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-[10px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm bg-ink px-2 py-0.5 text-[10px] text-white disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </form>
  );
}

export function ValueCell({
  companyId,
  value,
  display,
}: {
  companyId: string;
  value: string;
  display: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <CellButton pending={pending} onClick={() => setEditing(true)}>
        {display}
      </CellButton>
    );
  }

  const commit = (raw: string) => {
    setEditing(false);
    if (raw.trim() === value) return;
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("annualValue", raw);
    start(() => setCompanyValue(fd));
  };

  return (
    <input
      autoFocus
      type="text"
      inputMode="decimal"
      defaultValue={value}
      aria-label="Annual value"
      className={cn(editControl, "tabular-nums")}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(e.currentTarget.value);
        } else if (e.key === "Escape") {
          setEditing(false);
        }
      }}
    />
  );
}
