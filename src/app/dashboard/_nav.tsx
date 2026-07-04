"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui";

// Sidebar navigation. Grouped like the prototype: a labelled section per domain,
// active item marked with a gold left border. Items without an `href` are
// planned surfaces (later build-order slices) — shown, but inert, so the shell
// reads as the full product without linking to routes that don't exist yet.

type NavItem = { label: string; href?: string };
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: "Network",
    items: [
      { label: "Companies", href: "/dashboard/companies" },
      { label: "Contacts", href: "/dashboard/contacts" },
      { label: "Projects", href: "/dashboard/projects" },
      { label: "Introductions", href: "/dashboard/introductions" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Meetings", href: "/dashboard/meetings" },
      { label: "Invoices" },
    ],
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[9.5px] font-medium tracking-[0.1em] text-white/35 uppercase">
            {group.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active =
                item.href != null &&
                (pathname === item.href ||
                  pathname.startsWith(`${item.href}/`));
              const base =
                "block rounded-sm border-l-2 px-3 py-1.5 text-[13px] transition-colors";

              if (item.href == null) {
                return (
                  <li key={item.label}>
                    <span
                      className={cn(
                        base,
                        "cursor-default border-transparent text-white/25",
                      )}
                    >
                      {item.label}
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className={cn(
                      base,
                      active
                        ? "border-gold bg-white/5 text-white"
                        : "border-transparent text-white/70 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
