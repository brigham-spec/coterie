"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { CARD_ORDER_STORAGE_KEY, reconcileOrder } from "@/lib/card-order";

// Movable company-profile tiles (user: "the tiles within the company profiles
// should be able to be moved around for user preference"). Browser-only — the
// chosen order lives in localStorage (same mechanism as CollapsibleCard's
// per-card collapse memory), no DB. Each card keeps its own collapse state; this
// only governs vertical order.
//
// SSR renders the natural (prop) order, so the first client render matches (no
// hydration mismatch); the saved order is then applied before paint via a layout
// effect. A small grip handle (not the card body) is what becomes draggable, so
// dragging never fights the card's native <details> toggle.

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function CardReorder({
  cards,
}: {
  cards: { id: string; node: ReactNode }[];
}) {
  const ids = cards.map((c) => c.id);
  const [order, setOrder] = useState<string[]>(ids);
  const dragIdRef = useRef<string | null>(null);

  // Apply the remembered order before paint. ids is intentionally recomputed
  // each render but stable in content; key the effect on its join so a changed
  // card set re-reconciles.
  const idsKey = ids.join("|");
  useIsomorphicLayoutEffect(() => {
    let saved: string[] = [];
    try {
      const raw = window.localStorage.getItem(CARD_ORDER_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed))
          saved = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      saved = [];
    }
    setOrder(reconcileOrder(saved, idsKey.split("|")));
  }, [idsKey]);

  const persist = (next: string[]) => {
    setOrder(next);
    try {
      window.localStorage.setItem(CARD_ORDER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures (private mode, quota) — order just won't persist.
    }
  };

  const onDrop = (targetId: string) => {
    const from = dragIdRef.current;
    dragIdRef.current = null;
    if (from === null || from === targetId) return;
    const next = order.filter((id) => id !== from);
    const at = next.indexOf(targetId);
    next.splice(at, 0, from);
    persist(next);
  };

  const byId = new Map(cards.map((c) => [c.id, c.node] as const));

  return (
    <div>
      {order.map((id) => {
        const node = byId.get(id);
        if (node === undefined) return null;
        return (
          <CardSlot key={id} id={id} dragIdRef={dragIdRef} onDrop={() => onDrop(id)}>
            {node}
          </CardSlot>
        );
      })}
    </div>
  );
}

function CardSlot({
  id,
  dragIdRef,
  onDrop,
  children,
}: {
  id: string;
  dragIdRef: { current: string | null };
  onDrop: () => void;
  children: ReactNode;
}) {
  // The wrapper is draggable only while the pointer grabbed the grip handle, so
  // selecting text or toggling the card never starts a drag.
  const [draggable, setDraggable] = useState(false);

  return (
    <div
      draggable={draggable}
      onDragStart={() => {
        dragIdRef.current = id;
      }}
      onDragEnd={() => setDraggable(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className="group/card relative"
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        onMouseDown={() => setDraggable(true)}
        onMouseUp={() => setDraggable(false)}
        onBlur={() => setDraggable(false)}
        className="absolute top-3.5 -left-5 cursor-grab text-ink-3 opacity-0 transition-opacity group-hover/card:opacity-100 hover:text-gold active:cursor-grabbing"
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-3.5">
          <path
            d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {children}
    </div>
  );
}
