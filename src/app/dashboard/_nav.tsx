"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui";

import { NAV_GROUPS } from "./nav-items";

// Sidebar navigation. Grouped like the prototype: a labelled section per domain,
// active item marked with a gold left border. Destinations come from the shared
// NAV_GROUPS model (see nav-items.ts), also consumed by the command palette.

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[9.5px] font-medium tracking-[0.1em] text-white/35 uppercase">
            {group.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
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
                      "block rounded-sm border-l-2 px-3 py-1.5 text-[13px] transition-colors",
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
