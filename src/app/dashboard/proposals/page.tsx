import Link from "next/link";

import { requireOrgContext } from "@/lib/auth";
import { withOrg } from "@/lib/tenant";
import {
  proposalUrgency,
  type ProposalUrgencyLevel,
} from "@/lib/proposal-nudge";
import {
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

import { logProposalFollowUp } from "../companies/[id]/actions";

// Proposal Tracker (Dashboard item 6) — the cross-company membership-proposal
// pipeline. The per-company ProposalsCard logs/advances offers; this surface rolls
// every org proposal into one list, graded by follow-up urgency so staff can chase
// the ones that have gone quiet. Read-only except for the standalone "Log follow-up"
// button (logProposalFollowUp stamps lastFollowUpAt without moving the status). One
// withOrg pass loads every proposal; urgency + sort are derived from @/lib/proposal-nudge.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Urgency → badge tone + label. Overdue first, settled last (the sort key below
// keys off the same order).
const URGENCY: Record<
  ProposalUrgencyLevel,
  { tone: string; label: string; rank: number }
> = {
  overdue: { tone: "red", label: "Overdue", rank: 0 },
  "due-soon": { tone: "gold", label: "Due soon", rank: 1 },
  "on-track": { tone: "teal", label: "On track", rank: 2 },
  settled: { tone: "slate", label: "Settled", rank: 3 },
};

export default async function ProposalsPage() {
  const ctx = await requireOrgContext();
  const now = new Date();

  const proposals = await withOrg(ctx.orgId, (tx) =>
    tx.membershipProposal.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tier: true,
        amount: true,
        status: true,
        sentOn: true,
        lastFollowUpAt: true,
        createdAt: true,
        companyId: true,
        company: { select: { name: true } },
      },
    }),
  );

  // Grade each proposal, then order most-urgent-open first (settled sink to the
  // bottom, keeping their newest-first order via the stable sort).
  const rows = proposals
    .map((p) => ({
      ...p,
      urgency: proposalUrgency(
        {
          id: p.id,
          companyName: p.company.name,
          status: p.status,
          sentOn: p.sentOn,
          lastFollowUpAt: p.lastFollowUpAt,
          createdAt: p.createdAt,
        },
        now,
      ),
    }))
    .sort((a, b) => {
      const rankDelta = URGENCY[a.urgency.level].rank - URGENCY[b.urgency.level].rank;
      if (rankDelta !== 0) return rankDelta;
      return b.urgency.daysSinceContact - a.urgency.daysSinceContact;
    });

  const openCount = rows.filter((r) => r.urgency.level !== "settled").length;
  const overdueCount = rows.filter((r) => r.urgency.level === "overdue").length;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageTitle
        title="Membership Proposals"
        subtitle="Every membership offer across the network, graded by how long it has gone without a follow-up."
      />

      <div className="mt-4 mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Open" value={openCount} />
        <Stat label="Overdue" value={overdueCount} tone="red" />
        <Stat label="Total" value={rows.length} />
      </div>

      <Card>
        <CardHeader title="Pipeline" />
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-3">
            No proposals logged yet. Log the first offer from a company profile.
          </p>
        ) : (
          <Table
            head={
              <>
                <Th>Company</Th>
                <Th>Tier</Th>
                <Th>Status</Th>
                <Th>Last contact</Th>
                <Th>Follow-up</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </>
            }
          >
            {rows.map((r) => {
              const settled = r.urgency.level === "settled";
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link
                      href={`/dashboard/companies/${r.companyId}`}
                      className="font-medium text-ink hover:text-gold hover:underline"
                    >
                      {r.company.name}
                    </Link>
                  </Td>
                  <Td>
                    {r.tier}
                    {r.amount != null ? (
                      <span className="ml-1.5 text-ink-3">
                        {currency.format(Number(r.amount))}/yr
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td className="text-ink-2">
                    {r.urgency.daysSinceContact}d ago
                  </Td>
                  <Td>
                    <TagBadge
                      label={URGENCY[r.urgency.level].label}
                      tone={URGENCY[r.urgency.level].tone}
                    />
                  </Td>
                  <Td className="text-right">
                    {settled ? (
                      <span className="text-ink-3">—</span>
                    ) : (
                      <form action={logProposalFollowUp}>
                        <input type="hidden" name="proposalId" value={r.id} />
                        <button
                          type="submit"
                          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
                        >
                          Log follow-up
                        </button>
                      </form>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red";
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
        {label}
      </div>
      <div
        className={
          tone === "red" && value > 0
            ? "mt-1 text-2xl font-semibold text-red-ink"
            : "mt-1 text-2xl font-semibold text-ink"
        }
      >
        {value}
      </div>
    </div>
  );
}
