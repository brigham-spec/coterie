import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  Button,
  Card,
  CardHeader,
  Field,
  PageTitle,
  SelectField,
  StatusBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import { createCompany } from "./actions";

// Companies — the first tenant-scoped surface (build item 4). The layout has
// already resolved the tenant (React-cached), so requireOrgContext here reuses
// that context; the list reads through withOrg so RLS scopes it to this tenant.
// NoActiveOrg is handled by the layout, so it never renders without an org.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const statusOptions = [
  { value: "prospect", label: "Prospect" },
  { value: "member", label: "Member" },
  { value: "strategic_partner", label: "Strategic partner" },
  { value: "former", label: "Former" },
];

export default async function DashboardPage() {
  const ctx = await requireOrgContext();

  const companies = await withOrg(ctx.orgId, (tx) =>
    tx.company.findMany({ orderBy: { name: "asc" } }),
  );

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Companies"
          subtitle={`${companies.length} in ${ctx.orgName}'s network`}
        />
      </div>

      <Card>
        <CardHeader title="Add company" />
        <form action={createCompany} className="grid grid-cols-2 gap-4 p-4">
          <Field
            name="name"
            label="Company name"
            placeholder="Acme Corp"
            required
            className="col-span-2"
          />
          <SelectField name="status" label="Status" defaultValue="prospect">
            {statusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
          <Field
            name="industry"
            label="Industry"
            placeholder="Manufacturing"
            required
          />
          <Field
            name="annualValue"
            label="Annual value (USD)"
            placeholder="0"
            inputMode="decimal"
          />
          <div className="col-span-2 flex justify-end">
            <Button type="submit" variant="primary">
              Add company
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Network" />
        {companies.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No companies yet. Add one above.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Company</Th>
                <Th>Status</Th>
                <Th>Industry</Th>
                <Th>Annual value</Th>
              </>
            }
          >
            {companies.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
                <Td>{c.industry}</Td>
                <Td>{currency.format(Number(c.annualValue))}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
