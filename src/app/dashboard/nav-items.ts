// Sidebar navigation model — the single source of truth for the dashboard's
// destinations. Shared by the sidebar (_nav.tsx) and the command palette
// (_command-palette.tsx) so both stay in lockstep. Data only (no JSX), safe to
// import into a client component.

export type NavItem = { label: string; href: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Revenue", href: "/dashboard/revenue" },
    ],
  },
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
    label: "Intelligence",
    items: [
      { label: "Commitments", href: "/dashboard/commitments" },
      { label: "Network Search", href: "/dashboard/network-search" },
      { label: "Prospect Finder", href: "/dashboard/prospect-finder" },
      { label: "News", href: "/dashboard/news" },
      { label: "Email", href: "/dashboard/email" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Events", href: "/dashboard/events" },
      { label: "Meetings", href: "/dashboard/meetings" },
      { label: "Invoices", href: "/dashboard/invoices" },
      { label: "Value Created", href: "/dashboard/value-created" },
    ],
  },
  {
    label: "Organization",
    items: [{ label: "Settings", href: "/dashboard/settings" }],
  },
];
