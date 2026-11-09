"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

// Client filter bar for the contacts table. Search / company / tag / primary all
// live in the URL query string so the view is shareable and server-rendered —
// this component only translates control changes into router.push, preserving
// the active segment (and every other param it doesn't own). Search is debounced
// so typing doesn't fire a navigation per keystroke. The sibling of the companies
// filter bar (_filters.tsx there).

export type CompanyOption = { id: string; name: string };
export type TagOption = { key: string; label: string };

export function ContactFilters({
  companies,
  tags,
}: {
  companies: CompanyOption[];
  tags: TagOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const company = params.get("company") ?? "";
  const tag = params.get("tag") ?? "";
  const primaryOnly = params.get("primary") === "1";

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
        placeholder="Search contacts…"
        aria-label="Search contacts"
        className={`${control} min-w-[180px] flex-1`}
      />
      {companies.length > 0 ? (
        <select
          value={company}
          onChange={(e) => push({ company: e.target.value })}
          aria-label="Filter by company"
          className={control}
        >
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
      {tags.length > 0 ? (
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
      ) : null}
      <label className="flex items-center gap-1.5 text-xs text-ink-2">
        <input
          type="checkbox"
          checked={primaryOnly}
          onChange={(e) => push({ primary: e.target.checked ? "1" : "" })}
          className="size-3.5 accent-gold"
        />
        Primary only
      </label>
    </div>
  );
}
