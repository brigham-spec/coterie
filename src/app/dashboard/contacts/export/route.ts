import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { filterContacts } from "@/lib/contact-list";
import {
  CONTACT_CSV_HEADERS,
  contactCsvRow,
  csvAttachmentResponse,
  toCsv,
} from "@/lib/csv-export";

// Contacts CSV export (admin only). Mirrors the contacts list: it reads the same
// filter query params and runs the shared filterContacts predicate, so the
// download matches whatever view the admin exported from. One row per contact
// with its company name, name-ordered like the list. RLS scopes the read to this
// tenant via withOrg; a non-admin gets a bare 404 so the route stays hidden.

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin") return new Response("Not found", { status: 404 });

  const sp = new URL(req.url).searchParams;
  const one = (key: string): string => sp.get(key) ?? "";
  const filter = {
    segment: one("segment") || "all",
    q: one("q").trim().toLowerCase(),
    company: one("company"),
    tag: one("tag"),
    primaryOnly: one("primary") === "1",
  };

  const contacts = await withOrg(ctx.orgId, (tx) =>
    tx.contact.findMany({
      orderBy: { name: "asc" },
      include: { company: { select: { name: true, status: true } } },
    }),
  );
  const rows = filterContacts(
    contacts.map((c) => ({
      ...c,
      companyName: c.company.name,
      companyStatus: c.company.status,
    })),
    filter,
  );

  const csv = toCsv([
    CONTACT_CSV_HEADERS,
    ...rows.map((c) =>
      contactCsvRow({
        name: c.name,
        title: c.title,
        companyName: c.company.name,
        email: c.email,
        phone: c.phone,
        linkedin: c.linkedin,
        tags: c.tags,
        isPrimary: c.isPrimary,
      }),
    ),
  ]);

  return csvAttachmentResponse("coterie-contacts", ctx.orgName, csv);
}
