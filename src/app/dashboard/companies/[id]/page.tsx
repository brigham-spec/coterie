import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import { getTagDef } from "@/lib/tags";
import { getIntroStageDef } from "@/lib/intro-stages";
import { loadPendingIntroDetections } from "@/lib/intro-detection-load";
import {
  Button,
  Card,
  CardHeader,
  PageTitle,
  StatusBadge,
  TagBadge,
  Table,
  Td,
  Th,
  Tr,
} from "@/components/ui";

import { CompanyBrief } from "./_brief";
import { MeetingPrep } from "./_meeting-prep";
import { IntroSuggestions } from "./_intros";
import { confirmIntroAdvance } from "./actions";

// Company detail — the central relationship's home. Surfaces the company's own
// fields (including the slice-11.0 relationship attributes: what it's looking
// for / can offer, counties, deal size, network tags, owner, member-since) plus
// the relations we already have: contacts at the firm and the projects it
// participates in. Read withOrg-scoped; a lookup that returns null (not ours,
// or absent) is a 404.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrgContext();

  // Reads share one pooled connection inside the tx, so run them in sequence —
  // concurrent queries on a single pg client serialize and can stall the load.
  const { company, introductions, pendingIntros } = await withOrg(
    ctx.orgId,
    async (tx) => {
      const company = await tx.company.findUnique({
        where: { id },
        include: {
          owner: { select: { name: true } },
          contacts: { orderBy: { name: "asc" } },
          projectLinks: {
            include: {
              project: { select: { id: true, name: true, stage: true } },
            },
            orderBy: { role: "asc" },
          },
        },
      });
      // This company's introductions from the ledger, either party.
      const introductions = await tx.introduction.findMany({
        where: {
          OR: [{ partyA: { companyId: id } }, { partyB: { companyId: id } }],
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          outcome: true,
          partyA: {
            select: { name: true, company: { select: { id: true, name: true } } },
          },
          partyB: {
            select: { name: true, company: { select: { id: true, name: true } } },
          },
        },
      });
      // Fireflies-evidenced stage advances awaiting confirmation for this company.
      const pendingIntros = await loadPendingIntroDetections(tx, id);
      return { company, introductions, pendingIntros };
    },
  );

  if (company == null) notFound();

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Industry", value: company.industry },
    { label: "Tier", value: company.tier },
    { label: "Owner", value: company.owner?.name ?? null },
    { label: "Annual value", value: currency.format(Number(company.annualValue)) },
    {
      label: "Temperature",
      value: company.temperature == null ? null : `${company.temperature}%`,
    },
    {
      label: "Member since",
      value: company.memberSince == null ? null : String(company.memberSince),
    },
    { label: "Deal size", value: company.dealSize },
    {
      label: "Counties",
      value: company.counties.length ? company.counties.join(", ") : null,
    },
    { label: "Source", value: company.source },
    { label: "Email domain", value: company.emailDomain },
    { label: "Website", value: company.website },
  ];

  // Free-text relationship narrative — drives the intro engine downstream.
  const narrative: Array<{ label: string; value: string | null }> = [
    { label: "Looking for", value: company.lookingFor },
    { label: "Can offer", value: company.canOffer },
    { label: "Agency contacts", value: company.agencyContacts },
  ];
  const hasNarrative = narrative.some((n) => n.value);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6">
        <Link
          href="/dashboard/companies"
          className="text-[11px] text-ink-3 hover:text-gold"
        >
          ← Companies
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <PageTitle title={company.name} />
          <StatusBadge status={company.status} />
        </div>
        {company.networkTags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {company.networkTags.map((key) => {
              const def = getTagDef(key);
              return (
                <TagBadge
                  key={key}
                  label={def.label}
                  tone={def.tone}
                  title={def.desc}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader title="Details" />
        <dl className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                {f.label}
              </dt>
              <dd className="text-ink">{f.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {hasNarrative ? (
          <div className="grid gap-4 border-t border-line px-4 py-3 sm:grid-cols-3">
            {narrative.map((n) =>
              n.value ? (
                <div key={n.label}>
                  <div className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                    {n.label}
                  </div>
                  <p className="text-xs whitespace-pre-wrap text-ink-2">
                    {n.value}
                  </p>
                </div>
              ) : null,
            )}
          </div>
        ) : null}
        {company.notes ? (
          <div className="border-t border-line px-4 py-3">
            <div className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
              Notes
            </div>
            <p className="text-xs whitespace-pre-wrap text-ink-2">{company.notes}</p>
          </div>
        ) : null}
      </Card>

      <MeetingPrep companyId={company.id} />

      <CompanyBrief companyId={company.id} />

      <IntroSuggestions companyId={company.id} />

      <Card>
        <CardHeader
          title="Introductions"
          action={
            pendingIntros.length > 0 ? (
              <span className="rounded-full bg-teal-bg px-2 py-0.5 text-[10px] font-semibold text-teal-ink">
                {pendingIntros.length} pending
              </span>
            ) : null
          }
        />
        {pendingIntros.length > 0 ? (
          <div className="border-b border-line bg-teal-bg/30 px-4 py-3">
            <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-teal-ink uppercase">
              Detected from meetings
            </div>
            <div className="flex flex-col gap-2">
              {pendingIntros.map((d) => (
                <form
                  key={d.introId}
                  action={confirmIntroAdvance}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="introId" value={d.introId} />
                  <input type="hidden" name="status" value={d.suggestedStage} />
                  <input type="hidden" name="companyId" value={company.id} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-medium text-ink">
                      {d.partyALabel}{" "}
                      <span className="text-ink-3">&#8596;</span>{" "}
                      {d.partyBLabel}
                      <span className="ml-1.5 text-[10px] text-teal-ink">
                        &#8594; {getIntroStageDef(d.suggestedStage).label}
                      </span>
                    </div>
                    <div className="text-[10px] text-ink-3">
                      Detected: {d.meetingTitle} &middot;{" "}
                      {dateFmt.format(d.meetingDate)}
                    </div>
                  </div>
                  <Button type="submit">Confirm</Button>
                </form>
              ))}
            </div>
          </div>
        ) : null}
        {introductions.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No introductions involving this company yet. Record one on the{" "}
            <Link href="/dashboard/introductions" className="text-gold underline">
              introductions
            </Link>{" "}
            page.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Parties</Th>
                <Th>Stage</Th>
              </>
            }
          >
            {introductions.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <div className="font-medium text-ink">
                    {i.partyA.name}
                    <span className="text-ink-3"> · {i.partyA.company.name}</span>
                  </div>
                  <div className="font-medium text-ink">
                    {i.partyB.name}
                    <span className="text-ink-3"> · {i.partyB.company.name}</span>
                  </div>
                  {i.outcome ? (
                    <div className="mt-1 text-[10px] text-ink-3 italic">
                      {i.outcome}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  <StatusBadge status={i.status} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Contacts" />
        {company.contacts.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No contacts yet. Add one on the{" "}
            <Link href="/dashboard/contacts" className="text-gold underline">
              contacts
            </Link>{" "}
            page.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Name</Th>
                <Th>Title</Th>
                <Th>Email</Th>
                <Th>Tags</Th>
              </>
            }
          >
            {company.contacts.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">
                  {c.name}
                  {c.isPrimary ? (
                    <span className="ml-2 text-[10px] font-medium tracking-[0.06em] text-gold uppercase">
                      Primary
                    </span>
                  ) : null}
                  {c.linkedin ? (
                    <a
                      href={c.linkedin}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 text-[10px] text-ink-3 hover:text-gold hover:underline"
                    >
                      LinkedIn
                    </a>
                  ) : null}
                </Td>
                <Td>{c.title ?? "—"}</Td>
                <Td>{c.email ?? "—"}</Td>
                <Td>
                  {c.tags.length === 0 ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((key) => {
                        const def = getTagDef(key);
                        return (
                          <TagBadge
                            key={key}
                            label={def.label}
                            tone={def.tone}
                            title={def.desc}
                          />
                        );
                      })}
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Projects" />
        {company.projectLinks.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            Not linked to any projects yet.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Project</Th>
                <Th>Role</Th>
                <Th>Stage</Th>
              </>
            }
          >
            {company.projectLinks.map((l) => (
              <Tr key={l.projectId}>
                <Td className="font-medium">
                  <Link
                    href={`/dashboard/projects/${l.project.id}`}
                    className="hover:text-gold hover:underline"
                  >
                    {l.project.name}
                  </Link>
                </Td>
                <Td className="capitalize">{l.role.replace(/_/g, " ")}</Td>
                <Td>
                  <StatusBadge status={l.project.stage} />
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
