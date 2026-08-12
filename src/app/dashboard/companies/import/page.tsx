import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { IMPORT_TEMPLATE } from "@/lib/csv-import";
import { Button, Card, CardHeader, PageTitle } from "@/components/ui";

import { ImportForm } from "./_import-form";

// Admin-only bulk importer for companies + contacts. Reached from Settings and
// the Companies header; not in the nav (it would dead-end for staff). Non-admins
// get notFound() so the surface's existence isn't disclosed — the read-side
// admin idiom used by the other operator/admin pages. The static "import"
// segment wins over the sibling [id] dynamic route (same as invoices/grid).

export default async function ImportPage() {
  const ctx = await requireOrgContext();
  if (ctx.role !== "admin") notFound();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <PageTitle
          title="Bulk import"
          subtitle={`Add companies and contacts to ${ctx.orgName} from a CSV`}
        />
        <Link href="/dashboard/companies">
          <Button>Back to companies</Button>
        </Link>
      </div>

      <Card>
        <CardHeader title="Upload CSV" />
        <div className="p-4">
          <ImportForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="Format" />
        <div className="p-4">
          <p className="mb-3 text-xs text-ink-2">
            One row per contact, with their company&rsquo;s columns alongside.
            Rows sharing a <code className="text-ink">company_name</code> are
            grouped into one company (the first row&rsquo;s status, industry, and
            value win). Existing companies and contacts (matched by name and
            email) are left untouched, so re-importing is safe. Only{" "}
            <code className="text-ink">company_name</code> is required.
          </p>
          <pre className="overflow-x-auto rounded-sm border border-line-2 bg-surface-2 p-3 text-[11px] leading-relaxed text-ink-2">
            {IMPORT_TEMPLATE}
          </pre>
        </div>
      </Card>
    </div>
  );
}
