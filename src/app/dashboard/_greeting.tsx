"use client";

import { useEffect, useState } from "react";

// The dashboard greeting. Time-of-day and the date depend on the viewer's local
// clock, so they are computed on the client after mount (the server renders in
// UTC and would otherwise greet "good evening" at a US morning). Before mount we
// show a neutral greeting with the name so there's no layout shift or flash.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function timeOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function Greeting({ name }: { name: string }) {
  const first = name.trim().split(/\s+/)[0] || name;
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => setNow(new Date()));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div>
      <h1 className="font-serif text-[28px] leading-tight tracking-[-0.01em] text-ink">
        {now ? `${timeOfDay(now.getHours())}, ${first}` : `Welcome, ${first}`}
      </h1>
      <div className="mt-1 text-[12.5px] text-ink-3">
        {now ? dateFmt.format(now) : "\u00a0"}
      </div>
    </div>
  );
}
