// The base participation roles a company can hold on a project (the project_links
// role vocabulary, per schema §3.7). Shared by the project detail page's
// "Link a company" form and the company profile's "Link a project" form so the
// two link surfaces stay in lockstep. (Discipline roles for the professional
// team live separately in @/lib/team-roles.)
export const PROJECT_LINK_ROLES = [
  { value: "developer", label: "Developer" },
  { value: "lender", label: "Lender" },
  { value: "site_host", label: "Site host" },
  { value: "agency", label: "Agency" },
  { value: "advisor", label: "Advisor" },
] as const;
