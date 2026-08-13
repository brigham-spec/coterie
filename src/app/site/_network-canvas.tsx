"use client";

import { useEffect, useRef } from "react";

// Dispatched on window (detail `{ on }`) when the cursor enters/leaves a hero
// "connect" word ("network" / "Coterie") — the canvas listens and lights the
// whole network up. See ConnectTrigger in _connect-trigger.tsx.
export const CONNECT_EVENT = "coterie:connect";

// A living constellation: drifting nodes joined by hairline links, brightening
// near the cursor. Drawn on a canvas behind the hero — the brand metaphor ("the
// network is the strategy") rendered literally. Hovering "network"/"Coterie"
// wires every node together (Coterie connects them all). Honors reduced-motion
// (draws a single static frame) and cleans up its RAF loop + listeners on unmount.
export function NetworkCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el: HTMLCanvasElement | null = ref.current;
    if (!el) return;
    const c: CanvasRenderingContext2D | null = el.getContext("2d");
    if (!c) return;
    // Non-null aliases so narrowing survives into the nested closures below.
    const canvas: HTMLCanvasElement = el;
    const ctx: CanvasRenderingContext2D = c;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let nodes: { x: number; y: number; vx: number; vy: number }[] = [];
    const mouse = { x: -9999, y: -9999 };
    let raf = 0;

    // Hover-to-connect: `target` snaps to 1 while the cursor is over a hero
    // "connect" word, `intensity` eases toward it so the whole network lights up
    // and every node wires together. `connectDist` spans the canvas so links can
    // reach corner to corner at full intensity.
    let intensity = 0;
    let target = 0;
    let connectDist = 1;

    const LINK = 132;
    const MOUSE_LINK = 190;

    function seed() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      connectDist = Math.hypot(width, height) || 1;
      const count = Math.max(28, Math.min(96, Math.floor((width * height) / 15000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.24,
        vy: (Math.random() - 0.5) * 0.24,
      }));
    }

    function draw(step: boolean) {
      ctx.clearRect(0, 0, width, height);

      if (step) {
        for (const n of nodes) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > width) n.vx *= -1;
          if (n.y < 0 || n.y > height) n.vy *= -1;
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          const near = d < LINK ? (1 - d / LINK) * 0.34 : 0;
          const connected =
            intensity > 0.002 ? Math.max(0, 1 - d / connectDist) * 0.5 * intensity : 0;
          const alpha = Math.max(near, connected);
          if (alpha > 0.004) {
            ctx.strokeStyle = `rgba(212,168,67,${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        const dx = n.x - mouse.x;
        const dy = n.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < MOUSE_LINK) {
          ctx.strokeStyle = `rgba(244,241,235,${(1 - d / MOUSE_LINK) * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
        }
      }

      for (const n of nodes) {
        ctx.fillStyle = `rgba(244,241,235,${0.72 + 0.28 * intensity})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.4 + 0.5 * intensity, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop() {
      intensity += (target - intensity) * 0.09;
      if (target === 0 && intensity < 0.001) intensity = 0;
      draw(true);
      raf = requestAnimationFrame(loop);
    }

    function onResize() {
      seed();
      if (reduce) draw(false);
    }
    function onMove(e: PointerEvent) {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    }
    function onLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
    }
    function onConnect(e: Event) {
      const on = (e as CustomEvent<{ on?: boolean }>).detail?.on === true;
      target = on ? 1 : 0;
      if (reduce) {
        intensity = target;
        draw(false);
      }
    }

    seed();
    if (reduce) {
      draw(false);
    } else {
      raf = requestAnimationFrame(loop);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener(CONNECT_EVENT, onConnect);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener(CONNECT_EVENT, onConnect);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="absolute inset-0 h-full w-full"
    />
  );
}
