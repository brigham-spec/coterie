import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { filterCompanies } from "@/lib/company-list";
import { companyStatusLabel } from "@/lib/company-statuses";
import {
  COMPANY_CSV_HEADERS,
  companyCsvRow,
  csvAttachmentResponse,
  toCsv,
} from "@/lib/csv-export";

// Companies CSV export (admin only). Mirrors the companies list: it reads the
// same filter query params and runs the shared filterCompanies predicate, so the
// download matches whatever view the admin exported from. RLS scopes the read to
// this tenant via withOrg; a non-admin gets a bare 404 so the route stays hidden.

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin") return new Response("Not found", { status: 404 });

  const sp = new URL(req.url).searchParams;
  const one = (key: string): string => sp.get(key) ?? "";
  const filter = {
    segment: one("segment") || "all",
    q: one("q").trim().toLowerCase(),
    owner: one("owner") || "all",
    tag: one("tag"),
    tier: one("tier"),
    industry: one("industry"),
    likelihood: Number(one("likelihood")) || 0,
  };

  const companies = await withOrg(ctx.orgId, (tx) =>
    tx.company.findMany({
      orderBy: { name: "asc" },
      include: { owner: { select: { name: true } } },
    }),
  );
  const rows = filterCompanies(companies, filter);

  const csv = toCsv([
    COMPANY_CSV_HEADERS,
    ...rows.map((c) =>
      companyCsvRow({
        name: c.name,
        status: companyStatusLabel(c.status),
        tier: c.tier,
        industry: c.industry,
        counties: c.counties,
        annualValue: Number(c.annualValue),
        ownerName: c.owner?.name ?? null,
        website: c.website,
        linkedin: c.linkedin,
        lastContactAt: c.lastContactAt,
        memberSince: c.memberSince,
      }),
    ),
  ]);

  return csvAttachmentResponse("coterie-companies", ctx.orgName, csv);
}
