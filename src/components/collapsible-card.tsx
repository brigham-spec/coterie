"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "@/components/ui";

// useLayoutEffect runs before the browser paints (so a saved-closed card never
// flashes open-then-closed) but is a no-op that warns on the server; fall back
// to useEffect during SSR.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// A Card whose body collapses behind its header — the same chrome as
// Card + CardHeader, but the header is a native <details> summary so long pages
// (the company profile especially) can hide sections you don't need every visit.
// Zero-JS at its core (native <details>); the only client work is persisting the
// open/closed choice per card in localStorage, so a section you collapse stays
// collapsed across navigations. Server-rendered defaultOpen means no hydration
// mismatch — the saved state is applied imperatively before first paint.
//
// `id` must be stable + unique per card (it keys the persisted state). An
// optional `action` renders in the header like CardHeader's; clicking it never
// toggles the card (its clicks are stopped from reaching the summary).

export function CollapsibleCard({
  id,
  title,
  action,
  defaultOpen = true,
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const storageKey = `coterie:card:${id}`;

  // Apply the remembered state before paint (SSR renders defaultOpen, so no
  // hydration mismatch); a missing key keeps the server-rendered default.
  useIsomorphicLayoutEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved != null && ref.current) ref.current.open = saved === "1";
  }, [storageKey]);

  return (
    <details
      ref={ref}
      open={defaultOpen}
      onToggle={(e) =>
        window.localStorage.setItem(
          storageKey,
          e.currentTarget.open ? "1" : "0",
        )
      }
      className={cn(
        "group/cc mb-4 overflow-hidden rounded-md border border-line bg-surface shadow-card",
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <svg
            viewBox="0 0 16 16"
            aria-hidden
            className="size-3 shrink-0 text-ink-3 transition-transform group-open/cc:rotate-90"
          >
            <path
              d="M6 4l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="truncate font-serif text-[14px] leading-none text-ink">
            {title}
          </span>
        </span>
        {action ? (
          // Keep header actions (Add / Edit) from toggling the card.
          <span onClick={(e) => e.stopPropagation()}>{action}</span>
        ) : null}
      </summary>
      {children}
    </details>
  );
}
