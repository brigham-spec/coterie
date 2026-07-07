"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

// Client filter bar for the companies table. Search / owner / tag / sort all
// live in the URL query string so the view is shareable and server-rendered —
// this component only translates control changes into router.push, preserving
// the active segment (and every other param it doesn't own). Search is debounced
// so typing doesn't fire a navigation per keystroke.

export type OwnerOption = { id: string; name: string };
export type TagOption = { key: string; label: string };

const sortOptions = [
  { value: "name", label: "Name (A–Z)" },
  { value: "value", label: "Value (high–low)" },
  { value: "recent", label: "Last contact" },
];

export function CompanyFilters({
  owners,
  tags,
}: {
  owners: OwnerOption[];
  tags: TagOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const owner = params.get("owner") ?? "";
  const tag = params.get("tag") ?? "";
  const sort = params.get("sort") ?? "name";

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
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <input
        // Uncontrolled + keyed on the URL value: the box echoes keystrokes
        // locally (no per-keystroke navigation) and resets when q changes from
        // elsewhere (segment switch, back button), with no setState-in-effect.
        key={q}
        type="search"
        defaultValue={q}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search companies…"
        aria-label="Search companies"
        className={`${control} min-w-[180px] flex-1`}
      />
      <select
        value={owner}
        onChange={(e) => push({ owner: e.target.value })}
        aria-label="Filter by owner"
        className={control}
      >
        <option value="">All owners</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select
        value={tag}
        onChange={(e) => push({ tag: e.target.value })}
        aria-label="Filter by tag"
        className={control}
      >
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
      <select
        value={sort}
        onChange={(e) => push({ sort: e.target.value })}
        aria-label="Sort by"
        className={control}
      >
        {sortOptions.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
