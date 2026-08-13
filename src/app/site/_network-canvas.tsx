"use client";

import { useEffect, useRef } from "react";

// A living constellation: drifting nodes joined by hairline links, brightening
// near the cursor. Drawn on a canvas behind the hero — the brand metaphor ("the
// network is the strategy") rendered literally. Honors reduced-motion (draws a
// single static frame) and cleans up its RAF loop + listeners on unmount.
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

    const LINK = 132;
    const MOUSE_LINK = 190;

    function seed() {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
          if (d < LINK) {
            ctx.strokeStyle = `rgba(212,168,67,${(1 - d / LINK) * 0.34})`;
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
        ctx.fillStyle = "rgba(244,241,235,0.72)";
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function loop() {
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

    seed();
    if (reduce) {
      draw(false);
    } else {
      raf = requestAnimationFrame(loop);
    }
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
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
