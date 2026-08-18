import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  Card,
  CardHeader,
  PageTitle,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import { AddContactForm } from "./_add-contact-form";

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
          <AddContactForm
            companies={companies}
            existing={contacts.map((c) => ({
              id: c.id,
              name: c.name,
              companyId: c.companyId,
              email: c.email,
              companyName: c.company.name,
            }))}
          />
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
