"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/components/ui";

import { NAV_GROUPS, type NavIcon } from "./nav-items";

// Inline line icons (16px, currentColor, 1.5 stroke) keyed by NavItem.icon. Kept
// here (not in nav-items.ts) so that module stays JSX-free / palette-importable.
const NAV_ICONS: Record<NavIcon, ReactNode> = {
  dashboard: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  revenue: (
    <>
      <path d="M8 2.5v11" />
      <path d="M10.5 4.8c-.6-.8-1.5-1.1-2.5-1.1-1.4 0-2.5.8-2.5 2s1 1.6 2.5 1.9 2.5.7 2.5 2-1.1 2-2.5 2c-1 0-2-.4-2.5-1.2" />
    </>
  ),
  proposals: (
    <>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3" />
      <path d="M6 9h4M6 11h4" />
    </>
  ),
  companies: (
    <>
      <rect x="2.5" y="4" width="11" height="9.5" rx="1" />
      <path d="M5.5 4V2.5h5V4" />
      <path d="M5.5 7h1M9.5 7h1M5.5 10h1M9.5 10h1" />
    </>
  ),
  contacts: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
    </>
  ),
  projects: (
    <>
      <path d="M2.5 13.5V9l3-2 3 2.5 5-4.5" />
      <path d="M10.5 5h3v3" />
    </>
  ),
  introductions: (
    <>
      <circle cx="4.5" cy="8" r="2" />
      <circle cx="11.5" cy="8" r="2" />
      <path d="M6.5 8h3" />
    </>
  ),
  commitments: (
    <>
      <path d="M3 8.5l3 3 7-7.5" />
    </>
  ),
  "network-search": (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </>
  ),
  "prospect-finder": (
    <>
      <path d="M8 2.5l1.7 3.4 3.8.5-2.7 2.6.6 3.7L8 11.5 4.6 12.7l.6-3.7-2.7-2.6 3.8-.5z" />
    </>
  ),
  news: (
    <>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      <path d="M5 6h6M5 8h6M5 10h4" />
    </>
  ),
  email: (
    <>
      <rect x="2.5" y="4" width="11" height="8" rx="1" />
      <path d="M3 5l5 3.5L13 5" />
    </>
  ),
  events: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
      <path d="M2.5 6.5h11M5.5 2.5v2M10.5 2.5v2" />
    </>
  ),
  meetings: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  invoices: (
    <>
      <path d="M4 2.5h8v11l-2-1-2 1-2-1-2 1z" />
      <path d="M6 6h4M6 8.5h4" />
    </>
  ),
  "value-created": (
    <>
      <path d="M8 2.5l1.7 3.4 3.8.5-2.7 2.6.6 3.7L8 11.5 4.6 12.7l.6-3.7-2.7-2.6 3.8-.5z" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" />
    </>
  ),
};

function NavIconGlyph({ name }: { name: NavIcon }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      {NAV_ICONS[name]}
    </svg>
  );
}

// Sidebar navigation. Grouped like the prototype: a labelled section per domain,
// active item marked with a gold left border. Destinations come from the shared
// NAV_GROUPS model (see nav-items.ts), also consumed by the command palette, and
// are filtered to the modules this tenant has enabled (enabledHrefs, resolved
// server-side in the layout from @/lib/org-modules). A group with no visible
// items renders nothing.

export function Nav({ enabledHrefs }: { enabledHrefs: string[] }) {
  const pathname = usePathname();
  const visible = new Set(enabledHrefs);

  return (
    <nav className="flex flex-col gap-6">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => visible.has(item.href));
        if (items.length === 0) return null;
        return (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[9.5px] font-medium tracking-[0.1em] text-white/35 uppercase">
            {group.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => {
              // The dashboard root only lights on an exact match; every other
              // section stays lit on its detail sub-routes too.
              const active =
                pathname === item.href ||
                (item.href !== "/dashboard" &&
                  pathname.startsWith(`${item.href}/`));
              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-sm border-l-2 px-3 py-2 text-[13px] transition-colors",
                      active
                        ? "border-gold bg-white/8 text-white"
                        : "border-transparent text-white/60 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <span
                      className={cn(
                        "transition-colors",
                        active
                          ? "text-gold-line"
                          : "text-white/45 group-hover:text-white/70",
                      )}
                    >
                      <NavIconGlyph name={item.icon} />
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </nav>
  );
}
