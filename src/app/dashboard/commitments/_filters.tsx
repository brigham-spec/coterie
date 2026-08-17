"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

import { cn } from "@/components/ui";
import type { OwnerFacet } from "@/lib/commitments";

// Client toolbar for the commitments workspace: view tabs (List / Board /
// Completed) plus search, urgency chips, and per-owner chips (parity: 13007).
// Everything lives in the URL query string so the view is shareable and
// server-rendered — this only translates control changes into router.push,
// preserving the params it doesn't own. Search is debounced so typing doesn't
// fire a navigation per keystroke. Urgency/owner chips don't apply to the
// Completed ledger, so they're hidden there.

const VIEWS: { value: string; label: string }[] = [
  { value: "list", label: "List" },
  { value: "board", label: "Board" },
  { value: "completed", label: "Completed" },
];

const URGENCIES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "overdue", label: "Overdue" },
  { value: "soon", label: "Due soon" },
];

const SCOPES: { value: string; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "mine", label: "Mine" },
];

export function CommitmentFilters({
  owners,
  scope,
}: {
  owners: OwnerFacet[];
  scope: "mine" | "everyone";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view = params.get("view") ?? "list";
  const q = params.get("q") ?? "";
  const urgency = params.get("urgency") ?? "";
  const owner = params.get("owner") ?? "";

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function push(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    const query = sp.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function onSearch(value: string) {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => push({ q: value }), 300);
  }

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
      active
        ? "border-gold-line bg-gold-bg text-gold-ink"
        : "border-line-2 bg-surface text-ink-3 hover:text-ink",
    );

  const showChips = view !== "completed";

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-sm border border-line-2 bg-surface p-0.5 text-[11px]">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => push({ view: v.value === "list" ? "" : v.value })}
              className={cn(
                "rounded-sm px-2.5 py-1 font-medium transition-colors",
                view === v.value ? "bg-ink text-white" : "text-ink-3 hover:text-ink",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-sm border border-line-2 bg-surface p-0.5 text-[11px]">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() =>
                push({ scope: s.value === "everyone" ? "" : s.value, owner: "" })
              }
              className={cn(
                "rounded-sm px-2.5 py-1 font-medium transition-colors",
                scope === s.value ? "bg-ink text-white" : "text-ink-3 hover:text-ink",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <input
          key={q}
          type="search"
          defaultValue={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search commitments…"
          aria-label="Search commitments"
          className="min-w-[180px] flex-1 rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
        />
      </div>

      {showChips ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {URGENCIES.map((u) => (
            <button
              key={u.value || "all"}
              type="button"
              onClick={() => push({ urgency: u.value })}
              className={chip(urgency === u.value)}
            >
              {u.label}
            </button>
          ))}
          {scope === "everyone" && owners.length > 0 ? (
            <>
              <span className="mx-1 h-4 w-px bg-line-2" aria-hidden />
              {owners.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => push({ owner: owner === o.id ? "" : o.id })}
                  className={chip(owner === o.id)}
                >
                  {o.name}
                  <span className="ml-1 text-ink-3">{o.count}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
