"use client";

import { useState } from "react";
import Link from "next/link";

import {
  Button,
  Card,
  CardHeader,
  Field,
  SelectField,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { VALUE_KIND_DEFS } from "@/lib/value-kinds";
import {
  summarizeValueDelivered,
  type ValueDeliveredEntry,
} from "@/lib/value-delivered";

import { logValueDelivered, deleteValueDelivered } from "./actions";

// Value Delivered ledger (profile-parity P4). The org-wide rollup lives on the
// Value Created page; this is the per-member drill-down — the concrete wins the
// network delivered to THIS company (an intro that bore fruit, a grant, a
// service), each with its outcome and derived dollar value, summarized visually
// at the top. All writes go through the withOrg-scoped value actions; this holds
// only local UI state (whether the add form is showing).

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

const kindLabel = new Map(VALUE_KIND_DEFS.map((k) => [k.value, k.label]));

export type IntroOption = { id: string; label: string };

export function ValueDeliveredCard({
  companyId,
  entries,
  intros,
}: {
  companyId: string;
  entries: ValueDeliveredEntry[];
  intros: IntroOption[];
}) {
  const [adding, setAdding] = useState(false);
  const summary = summarizeValueDelivered(entries);
  // Normalize the per-kind bars against the richest kind (by dollars if any
  // carry a figure, else by count so non-monetary wins still chart).
  const useAmount = summary.totalAmount > 0;
  const magnitude = (k: { amount: number; count: number }) =>
    useAmount ? k.amount : k.count;
  const barMax = Math.max(1, ...summary.byKind.map(magnitude));

  return (
    <Card>
      <CardHeader
        title="Value delivered"
        action={
          <div className="flex items-center gap-4">
            {entries.length > 0 ? (
              <Link
                href={`/dashboard/companies/${companyId}/value-report`}
                className="text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase hover:text-ink"
              >
                View report
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {adding ? "Close" : "Log value"}
            </button>
          </div>
        }
      />

      {entries.length > 0 ? (
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-ink">
              {currency.format(summary.totalAmount)}
            </span>
            <span className="text-[11px] text-ink-3">
              delivered across {summary.entryCount}{" "}
              {summary.entryCount === 1 ? "win" : "wins"}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {summary.byKind.map((k) => {
              const pct = Math.round((magnitude(k) / barMax) * 100);
              return (
                <div key={k.kind} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[10px] tracking-[0.04em] text-ink-3 uppercase">
                    {kindLabel.get(k.kind) ?? k.kind}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full bg-gold"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-[10px] text-ink-2">
                    {k.amount > 0 ? currency.format(k.amount) : `${k.count}×`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {adding ? (
        <div className="border-b border-line p-4">
          <ValueForm
            companyId={companyId}
            intros={intros}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No value logged yet. Use “Log value” to record an introduction outcome,
          grant, or service delivered to this member.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <ValueItem key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ValueItem({ entry }: { entry: ValueDeliveredEntry }) {
  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <StatusBadge status={entry.kind} />
          {entry.amount != null ? (
            <span className="text-xs font-medium text-ink">
              {currency.format(entry.amount)}
            </span>
          ) : null}
          <span className="text-[10px] text-ink-3">
            {dateFmt.format(entry.occurredAt)}
          </span>
        </div>
        <div className="mt-1 text-xs font-medium text-ink">{entry.summary}</div>
        {entry.outcome ? (
          <p className="mt-0.5 text-xs whitespace-pre-wrap text-ink-2">
            {entry.outcome}
          </p>
        ) : null}
        {entry.introLabel ? (
          <div className="mt-1 text-[10px] text-ink-3">
            From introduction: {entry.introLabel}
          </div>
        ) : null}
      </div>
      <form action={deleteValueDelivered}>
        <input type="hidden" name="valueId" value={entry.id} />
        <button
          type="submit"
          className="shrink-0 text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
        >
          Remove
        </button>
      </form>
    </li>
  );
}

function ValueForm({
  companyId,
  intros,
  onDone,
}: {
  companyId: string;
  intros: IntroOption[];
  onDone: () => void;
}) {
  return (
    <form
      action={async (fd) => {
        await logValueDelivered(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="companyId" value={companyId} />

      <div className="grid grid-cols-2 gap-4">
        <SelectField name="kind" label="Kind" defaultValue="introduction">
          {VALUE_KIND_DEFS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </SelectField>
        <Field name="amount" label="Value ($)" type="number" min={0} step="1" />
        <Field
          name="summary"
          label="What was delivered"
          required
          className="col-span-2"
        />
        <Field name="occurredAt" label="Date" type="date" />
        {intros.length > 0 ? (
          <SelectField name="introductionId" label="From introduction" defaultValue="">
            <option value="">None</option>
            {intros.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>

      <Textarea name="outcome" label="Outcome" />

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Log value
        </Button>
      </div>
    </form>
  );
}
