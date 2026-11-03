"use client";

import { useState } from "react";
import Link from "next/link";

import { cn } from "@/components/ui";

export type IndustryChip = {
  name: string;
  count: number;
  href: string;
  active: boolean;
};

// How many chips to show before tucking the rest behind a "more" toggle.
const VISIBLE_LIMIT = 8;

// Industry filter chips for the Companies list. The category list can get long,
// so by default we show only the busiest few (plus the active one, if it happens
// to be in the hidden tail, so the current selection never disappears) and hide
// the rest behind a "+N more" toggle. Pure client state — toggling doesn't touch
// the URL, so every other filter is preserved.
export function IndustryChips({ chips }: { chips: IndustryChip[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = chips.length > VISIBLE_LIMIT;
  const visible = expanded
    ? chips
    : chips.filter((chip, i) => i < VISIBLE_LIMIT || chip.active);
  const hiddenCount = chips.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
      {visible.map((chip) => (
        <Link
          key={chip.name}
          href={chip.href}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10.5px] transition-colors",
            chip.active
              ? "bg-ink text-white"
              : "bg-surface-2 text-ink-3 hover:bg-surface-3 hover:text-ink",
          )}
        >
          {chip.name}
          <span className={cn("ml-1", chip.active ? "text-white/60" : "text-ink-3")}>
            {chip.count}
          </span>
        </Link>
      ))}
      {hasOverflow ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-full px-2.5 py-0.5 text-[10.5px] text-ink-3 transition-colors hover:text-ink"
        >
          {expanded ? "Show less" : `+${hiddenCount} more`}
        </button>
      ) : null}
    </div>
  );
}
