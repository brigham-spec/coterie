import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  CONTACT_CSV_HEADERS,
  contactCsvRow,
  csvAttachmentResponse,
  toCsv,
} from "@/lib/csv-export";

// Contacts CSV export (admin only). One row per contact with its company name,
// name-ordered like the contacts list. RLS scopes the read to this tenant via
// withOrg; a non-admin gets a bare 404 so the route stays hidden from staff.

export async function GET(): Promise<Response> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin") return new Response("Not found", { status: 404 });

  const contacts = await withOrg(ctx.orgId, (tx) =>
    tx.contact.findMany({
      orderBy: { name: "asc" },
      include: { company: { select: { name: true } } },
    }),
  );

  const csv = toCsv([
    CONTACT_CSV_HEADERS,
    ...contacts.map((c) =>
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
