// Sidebar navigation model — the single source of truth for the dashboard's
// destinations. Shared by the sidebar (_nav.tsx) and the command palette
// (_command-palette.tsx) so both stay in lockstep. Data only (no JSX), safe to
// import into a client component.

// `icon` is a stable key resolved to an inline SVG in _nav.tsx (NAV_ICONS). Kept
// as a string here so this module stays data-only (no JSX) and importable by the
// command palette.
export type NavIcon =
  | "dashboard"
  | "revenue"
  | "proposals"
  | "companies"
  | "contacts"
  | "projects"
  | "introductions"
  | "commitments"
  | "network-search"
  | "prospect-finder"
  | "linkedin"
  | "sop-assistant"
  | "news"
  | "email"
  | "events"
  | "meetings"
  | "invoices"
  | "value-created"
  | "settings";

export type NavItem = { label: string; href: string; icon: NavIcon };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
      { label: "Revenue", href: "/dashboard/revenue", icon: "revenue" },
      { label: "Proposals", href: "/dashboard/proposals", icon: "proposals" },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Companies", href: "/dashboard/companies", icon: "companies" },
      { label: "Contacts", href: "/dashboard/contacts", icon: "contacts" },
      { label: "Projects", href: "/dashboard/projects", icon: "projects" },
      {
        label: "Introductions",
        href: "/dashboard/introductions",
        icon: "introductions",
      },
    ],
  },
  {
    label: "Intelligence",
    items: [
      {
        label: "Commitments",
        href: "/dashboard/commitments",
        icon: "commitments",
      },
      {
        label: "Network Search",
        href: "/dashboard/network-search",
        icon: "network-search",
      },
      {
        label: "Prospect Finder",
        href: "/dashboard/prospect-finder",
        icon: "prospect-finder",
      },
      { label: "LinkedIn", href: "/dashboard/linkedin", icon: "linkedin" },
      {
        label: "Document Assistant",
        href: "/dashboard/sop-assistant",
        icon: "sop-assistant",
      },
      { label: "News", href: "/dashboard/news", icon: "news" },
      { label: "Email", href: "/dashboard/email", icon: "email" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Events", href: "/dashboard/events", icon: "events" },
      { label: "Meetings", href: "/dashboard/meetings", icon: "meetings" },
      { label: "Invoices", href: "/dashboard/invoices", icon: "invoices" },
      {
        label: "Value Created",
        href: "/dashboard/value-created",
        icon: "value-created",
      },
    ],
  },
  {
    label: "Organization",
    items: [{ label: "Settings", href: "/dashboard/settings", icon: "settings" }],
  },
];
