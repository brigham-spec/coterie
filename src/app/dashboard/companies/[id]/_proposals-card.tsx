"use client";

import { useState } from "react";

import {
  Button,
  Card,
  CardHeader,
  Field,
  SelectField,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { PROPOSAL_STATUS_DEFS } from "@/lib/proposal-statuses";

import {
  createProposal,
  updateProposalStatus,
  deleteProposal,
} from "./actions";

// Membership Proposals ledger (profile-parity P3). The company profile is
// otherwise read-only; this owns the log/track/close surface for the firm's
// membership offers, mirroring the prototype's proposal tracker. All writes go
// through the withOrg-scoped proposal actions — this holds only local UI state
// (whether the add form is showing). Winning a proposal is handled server-side
// (a prospect is nudged to member); after any save the server revalidates.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Pin UTC: sentOn is a @db.Date (UTC-midnight), and fixing the zone keeps the
// server and client renders identical so React doesn't flag a hydration mismatch.
const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export type ProposalRow = {
  id: string;
  tier: string;
  amount: number | null;
  status: string;
  sentOn: Date | null;
  driveUrl: string | null;
  notes: string;
};

export function ProposalsCard({
  companyId,
  proposals,
}: {
  companyId: string;
  proposals: ProposalRow[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Membership proposals"
        action={
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            {adding ? "Close" : "Log proposal"}
          </button>
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <ProposalForm companyId={companyId} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      {proposals.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No proposals logged yet. Use “Log proposal” to record the first offer.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {proposals.map((p) => (
            <ProposalItem key={p.id} proposal={p} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProposalItem({ proposal }: { proposal: ProposalRow }) {
  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-ink">
            {proposal.tier}
            {proposal.amount != null ? (
              <span className="ml-1.5 text-ink-2">
                {currency.format(proposal.amount)}/yr
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
            <StatusBadge status={proposal.status} />
            {proposal.sentOn ? (
              <span>Sent {dateFmt.format(proposal.sentOn)}</span>
            ) : null}
            {proposal.driveUrl ? (
              <a
                href={proposal.driveUrl}
                target="_blank"
                rel="noreferrer"
                className="text-gold hover:underline"
              >
                Document
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <form action={updateProposalStatus} className="flex items-center">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <select
              name="status"
              defaultValue={proposal.status}
              className="rounded-sm border border-line-2 bg-surface px-2 py-1 text-[11px] text-ink outline-none focus:border-gold-line"
              // Advance the pipeline on select; the surrounding form submits.
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            >
              {PROPOSAL_STATUS_DEFS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </form>
          <form action={deleteProposal}>
            <input type="hidden" name="proposalId" value={proposal.id} />
            <button
              type="submit"
              className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
            >
              Remove
            </button>
          </form>
        </div>
      </div>

      {proposal.notes ? (
        <p className="text-xs whitespace-pre-wrap text-ink-2">{proposal.notes}</p>
      ) : null}
    </li>
  );
}

function ProposalForm({
  companyId,
  onDone,
}: {
  companyId: string;
  onDone: () => void;
}) {
  return (
    <form
      action={async (fd) => {
        await createProposal(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="companyId" value={companyId} />

      <div className="grid grid-cols-2 gap-4">
        <Field name="tier" label="Tier" required />
        <Field name="amount" label="Amount ($/yr)" type="number" min={0} step="1" />
        <SelectField name="status" label="Status" defaultValue="draft">
          {PROPOSAL_STATUS_DEFS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <Field name="sentOn" label="Sent on" type="date" />
        <Field
          name="driveUrl"
          label="Document URL"
          className="col-span-2"
        />
      </div>

      <Textarea name="notes" label="Notes" />

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Log proposal
        </Button>
      </div>
    </form>
  );
}
