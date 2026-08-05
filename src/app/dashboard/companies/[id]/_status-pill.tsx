"use client";

import { useState, useTransition } from "react";

import { StatusBadge } from "@/components/ui";
import { COMPANY_STATUS_DEFS } from "@/lib/company-statuses";

import { changeCompanyStatus } from "./actions";

// In-header status quick-change pill (Members 17). The current status renders as
// the familiar StatusBadge; clicking it opens a menu of every lifecycle status.
// Choosing one calls changeCompanyStatus — which logs an Activity for the
// relationship timeline and revalidates — so a status can be reached from the
// header without opening the edit form. Choosing the current status is a no-op
// (guarded here and again server-side). A fixed transparent backdrop dismisses
// the menu on an outside click and Escape closes it, matching the command
// palette's dismiss idiom.
export function StatusPill({
  companyId,
  status,
}: {
  companyId: string;
  status: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(next: string) {
    setOpen(false);
    if (next === status) return;
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("status", next);
    startTransition(() => changeCompanyStatus(fd));
  }

  return (
    <span
      className="relative inline-flex"
      onKeyDown={(e) => {
        // Escape closes the menu, matching the command palette's dismiss idiom.
        // Focus stays on the trigger while open, so its keydown bubbles here.
        if (e.key === "Escape" && open) {
          e.preventDefault();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change status"
        className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-gold-line disabled:opacity-60"
      >
        <StatusBadge status={status} />
        <span aria-hidden className="text-[8px] text-ink-3">
          {"\u25BE"}
        </span>
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute top-full left-0 z-50 mt-1 min-w-[168px] overflow-hidden rounded-md border border-line bg-surface py-1 shadow-pop"
          >
            {COMPANY_STATUS_DEFS.map((s) => (
              <button
                key={s.value}
                type="button"
                role="menuitem"
                onClick={() => choose(s.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <StatusBadge status={s.value} />
                {s.value === status ? (
                  <span className="ml-auto text-[10px] text-ink-3">current</span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </span>
  );
}
