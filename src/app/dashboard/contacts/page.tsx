import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  Button,
  Card,
  CardHeader,
  Field,
  PageTitle,
  SelectField,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import { createContact } from "./actions";

// Contacts — people at the tenant's companies (build item 4). A contact must
// belong to a company, so the create form is a company-scoped select. Both the
// company options and the contact list are read through withOrg (RLS-scoped) in
// a single transaction, so nothing outside this tenant is ever visible.

export default async function ContactsPage() {
  const ctx = await requireOrgContext();

  // Sequential reads: one pooled connection per tx, so no concurrent queries.
  const { companies, contacts } = await withOrg(ctx.orgId, async (tx) => {
    const companies = await tx.company.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const contacts = await tx.contact.findMany({
      orderBy: { name: "asc" },
      include: { company: { select: { name: true } } },
    });
    return { companies, contacts };
  });

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <PageTitle
          title="Contacts"
          subtitle={`${contacts.length} across ${ctx.orgName}'s network`}
        />
      </div>

      {companies.length === 0 ? (
        <Card>
          <CardHeader title="Add contact" />
          <p className="px-4 py-6 text-xs text-ink-3">
            Add a{" "}
            <Link href="/dashboard/companies" className="text-gold underline">
              company
            </Link>{" "}
            first — every contact belongs to one.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Add contact" />
          <form action={createContact} className="grid grid-cols-2 gap-4 p-4">
            <SelectField
              name="companyId"
              label="Company"
              defaultValue=""
              required
              className="col-span-2"
            >
              <option value="" disabled>
                Select a company…
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <Field
              name="name"
              label="Name"
              placeholder="Jane Doe"
              required
            />
            <Field name="title" label="Title" placeholder="VP, Operations" />
            <Field
              name="email"
              label="Email"
              type="email"
              placeholder="jane@acme.com"
            />
            <Field name="phone" label="Phone" placeholder="(555) 010-0100" />
            <div className="col-span-2 flex justify-end">
              <Button type="submit" variant="primary">
                Add contact
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="People" />
        {contacts.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No contacts yet.{companies.length > 0 ? " Add one above." : ""}
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>Title</Th>
                <Th>Company</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
              </>
            }
          >
            {contacts.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">
                  <Link
                    href={`/dashboard/contacts/${c.id}`}
                    className="hover:text-gold hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.isPrimary ? (
                    <span className="ml-2 text-[10px] font-medium tracking-[0.06em] text-gold uppercase">
                      Primary
                    </span>
                  ) : null}
                </Td>
                <Td>{c.title ?? "—"}</Td>
                <Td>{c.company.name}</Td>
                <Td>{c.email ?? "—"}</Td>
                <Td>{c.phone ?? "—"}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
