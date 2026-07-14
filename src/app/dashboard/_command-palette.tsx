"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/components/ui";

import { NAV_GROUPS } from "./nav-items";
import { searchNetwork, type SearchResult } from "./actions";

// Global command palette (review Tier-1). Cmd/Ctrl+K opens a centered overlay
// that filters the sidebar destinations and searches the tenant's companies,
// contacts, and projects by name (searchNetwork, RLS-scoped). Arrow keys move
// the selection, Enter navigates, Escape closes. Mounted once in the dashboard
// layout so it is available on every page.

type NavCommand = { label: string; group: string; href: string };

const NAV_COMMANDS: NavCommand[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((item) => ({ label: item.label, group: g.label, href: item.href })),
);

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  company: "Companies",
  contact: "Contacts",
  project: "Projects",
};

// One flat, ordered list of what Enter can act on — nav matches first, then the
// entity results in type order — so keyboard selection and rendering share an
// index.
type Row = {
  href: string;
  label: string;
  sublabel: string;
  section: string;
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setSelected(0);
  }, []);

  // Global Cmd/Ctrl+K toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input each time the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced entity search. The `active` flag guards against out-of-order
  // responses so a slow earlier query can't overwrite a newer one's results.
  // Every setState here lives inside the timeout callback (not the effect body)
  // so it never triggers a cascading synchronous render.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    let active = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const found = await searchNetwork(term);
        if (active) setResults(found);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 150);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  const q = query.trim().toLowerCase();
  const navMatches =
    q === ""
      ? NAV_COMMANDS
      : NAV_COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  // Only surface entity results once the query is long enough to have triggered
  // a search; below that the effect never runs, so `results`/`loading` may be
  // stale from a prior longer query.
  const searching = q.length >= 2;
  const entityResults = searching ? results : [];
  const showLoading = searching && loading;

  const rows: Row[] = [
    ...navMatches.map((c) => ({
      href: c.href,
      label: c.label,
      sublabel: c.group,
      section: "Navigate",
    })),
    ...entityResults.map((r) => ({
      href: r.href,
      label: r.label,
      sublabel: r.sublabel,
      section: TYPE_LABEL[r.type],
    })),
  ];

  // Clamp the selection into range during render rather than via an effect.
  const selectedIndex = rows.length === 0 ? 0 : Math.min(selected, rows.length - 1);

  function go(row: Row | undefined) {
    if (!row) return;
    close();
    router.push(row.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length > 0) setSelected((selectedIndex + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length > 0)
        setSelected((selectedIndex - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(rows[selectedIndex]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-sm border border-line-2 bg-surface px-2.5 py-1.5 text-[11px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
      >
        <span>Search</span>
        <kbd className="rounded-sm border border-line bg-surface-2 px-1 py-px font-sans text-[9px] text-ink-3">
          &#8984;K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[1px]"
          onMouseDown={close}
        >
          <div
            className="mx-auto mt-[12vh] w-full max-w-lg overflow-hidden rounded-md border border-line bg-surface shadow-pop"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search companies, contacts, projects — or jump to a page"
              className="w-full border-b border-line bg-surface px-4 py-3 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />

            <div className="max-h-[52vh] overflow-y-auto py-1">
              {rows.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] text-ink-3">
                  {showLoading
                    ? "Searching\u2026"
                    : q.length >= 2
                      ? "No matches"
                      : "Type to search"}
                </p>
              ) : (
                <PaletteRows
                  rows={rows}
                  selected={selectedIndex}
                  onSelect={setSelected}
                  onGo={go}
                />
              )}
            </div>

            <div className="flex items-center gap-3 border-t border-line bg-surface-2 px-4 py-1.5 text-[9.5px] text-ink-3">
              <span>
                <kbd className="font-sans">&#8593;&#8595;</kbd> navigate
              </span>
              <span>
                <kbd className="font-sans">&#8629;</kbd> open
              </span>
              <span>
                <kbd className="font-sans">esc</kbd> close
              </span>
              {loading ? <span className="ml-auto">Searching&#8230;</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PaletteRows({
  rows,
  selected,
  onSelect,
  onGo,
}: {
  rows: Row[];
  selected: number;
  onSelect: (i: number) => void;
  onGo: (row: Row) => void;
}) {
  return (
    <>
      {rows.map((row, i) => {
        const header =
          i === 0 || rows[i - 1].section !== row.section ? row.section : null;
        return (
          <div key={`${row.href}-${i}`}>
            {header ? (
              <div className="px-4 pt-2 pb-1 text-[9px] font-medium tracking-[0.08em] text-ink-3 uppercase">
                {header}
              </div>
            ) : null}
            <button
              type="button"
              onMouseEnter={() => onSelect(i)}
              onClick={() => onGo(row)}
              className={cn(
                "flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors",
                i === selected ? "bg-surface-2" : "bg-surface",
              )}
            >
              <span className="truncate text-[12.5px] text-ink">{row.label}</span>
              {row.sublabel ? (
                <span className="flex-shrink-0 truncate text-[10.5px] text-ink-3">
                  {row.sublabel}
                </span>
              ) : null}
            </button>
          </div>
        );
      })}
    </>
  );
}
