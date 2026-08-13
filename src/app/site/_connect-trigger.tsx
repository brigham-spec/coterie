"use client";

import type { ReactNode } from "react";

import { CONNECT_EVENT } from "./_network-canvas";

// Wraps a hero "connect" word ("network" / "Coterie"). On hover it fires the
// CONNECT_EVENT the NetworkCanvas listens for, wiring every node together —
// Coterie is the tool that connects the whole network.
export function ConnectTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const emit = (on: boolean) =>
    window.dispatchEvent(new CustomEvent(CONNECT_EVENT, { detail: { on } }));
  return (
    <span
      className={className}
      onPointerEnter={() => emit(true)}
      onPointerLeave={() => emit(false)}
    >
      {children}
    </span>
  );
}
