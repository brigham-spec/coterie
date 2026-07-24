"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

import type { MeetingMember } from "@/lib/meetings-view";

// Client filter bar for the meetings list (parity: Meet 8). Keyword / source /
// member all live in the URL query string so the view is shareable and
// server-rendered — this only translates control changes into router.push.
// Keyword search is debounced so typing doesn't navigate per keystroke.

export function MeetingFilters({ members }: { members: MeetingMember[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const source = params.get("source") ?? "";
  const member = params.get("member") ?? "";

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

  const control =
    "rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-gold-line";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        key={q}
        type="search"
        defaultValue={q}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search meetings…"
        aria-label="Search meetings"
        className={`${control} min-w-[180px] flex-1`}
      />
      <select
        value={source}
        onChange={(e) => push({ source: e.target.value })}
        aria-label="Filter by source"
        className={control}
      >
        <option value="">All sources</option>
        <option value="fireflies">Fireflies</option>
        <option value="manual">Manual</option>
      </select>
      {members.length > 0 ? (
        <select
          value={member}
          onChange={(e) => push({ member: e.target.value })}
          aria-label="Filter by member"
          className={control}
        >
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
