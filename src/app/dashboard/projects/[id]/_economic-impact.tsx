"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, SelectField } from "@/components/ui";
import { GRANT_STATUSES, type ImpactForm } from "@/lib/value-created";

import {
  updateEconomicImpact,
  addProjectGrant,
  removeProjectGrant,
} from "../actions";

// Economic Impact card (projects-module parity; ported from the prototype's
// "Economic Impact" section, Coterie.html:17727). Captures the regional impact a
// project generates — jobs, construction cost, a tax abatement, and a list of
// state grants — which feed the Value Created rollup. All money in dollars. Writes
// go through the withOrg-scoped actions; this holds only local UI state (open forms).

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Grant status tone (literal classes for Tailwind's JIT).
const grantStatusText: Record<string, string> = {
  Applied: "text-amber-ink",
  Awarded: "text-teal-ink font-semibold",
  Received: "text-teal-ink font-semibold",
  Declined: "text-red-ink",
};

export function EconomicImpactCard({
  projectId,
  impact,
}: {
  projectId: string;
  impact: ImpactForm;
}) {
  const [editing, setEditing] = useState(false);
  const [addingGrant, setAddingGrant] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Economic impact"
        action={
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            {editing ? "Close" : "Edit"}
          </button>
        }
      />

      <p className="border-b border-line px-4 py-2 text-[10.5px] text-ink-3">
        Jobs, construction cost, tax abatements, and state grants — these flow into
        your Value Created reporting.
      </p>

      {editing ? (
        <form
          action={async (fd) => {
            await updateEconomicImpact(fd);
            setEditing(false);
          }}
          className="border-b border-line p-4"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field
              name="permanentJobs"
              label="Permanent FT jobs"
              inputMode="numeric"
              defaultValue={String(impact.permanentJobs || "")}
              placeholder="0"
            />
            <Field
              name="constructionJobs"
              label="Construction jobs"
              inputMode="numeric"
              defaultValue={String(impact.constructionJobs || "")}
              placeholder="0"
            />
            <Field
              name="constructionCost"
              label="Construction cost ($)"
              inputMode="numeric"
              defaultValue={String(impact.constructionCost || "")}
              placeholder="0"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                name="taxAbatementActive"
                defaultChecked={impact.taxAbatementActive}
                className="h-3.5 w-3.5"
              />
              Tax abatement / PILOT active
            </label>
            <Field
              name="taxAbatementValue"
              label="Abatement value ($, lifetime)"
              inputMode="numeric"
              defaultValue={String(impact.taxAbatementValue || "")}
              placeholder="0"
              className="min-w-[200px]"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save impact
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-3">
          <Fact label="Permanent FT jobs" value={numOrDash(impact.permanentJobs)} />
          <Fact label="Construction jobs" value={numOrDash(impact.constructionJobs)} />
          <Fact label="Construction cost" value={moneyOrDash(impact.constructionCost)} />
          <Fact
            label="Tax abatement"
            value={
              impact.taxAbatementActive
                ? moneyOrDash(impact.taxAbatementValue)
                : "—"
            }
          />
        </dl>
      )}

      <div className="flex items-center justify-between border-t border-line px-4 py-2">
        <span className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase">
          State grants & subsidies
        </span>
        <button
          type="button"
          onClick={() => setAddingGrant((v) => !v)}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          {addingGrant ? "Close" : "+ Grant"}
        </button>
      </div>

      {addingGrant ? (
        <form
          action={async (fd) => {
            await addProjectGrant(fd);
            setAddingGrant(false);
          }}
          className="grid grid-cols-2 gap-4 border-b border-line p-4 sm:grid-cols-4"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Field
            name="name"
            label="Program name"
            placeholder="e.g. Restore NY"
            required
            className="col-span-2"
          />
          <Field
            name="amount"
            label="Amount ($)"
            inputMode="numeric"
            placeholder="0"
          />
          <SelectField name="status" label="Status" defaultValue="Applied">
            {GRANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <div className="col-span-2 flex justify-end sm:col-span-4">
            <Button type="submit" variant="primary">
              Add grant
            </Button>
          </div>
        </form>
      ) : null}

      {impact.grants.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No grants tracked yet.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {impact.grants.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <span className="text-xs font-medium text-ink">{g.name}</span>
                <span
                  className={`ml-2 text-[10px] ${grantStatusText[g.status] ?? "text-ink-3"}`}
                >
                  {g.status}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[11px] font-medium text-ink-2">
                  {moneyOrDash(g.amount)}
                </span>
                <form action={removeProjectGrant}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="grantId" value={g.id} />
                  <button
                    type="submit"
                    className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
                  >
                    Remove
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="mb-1 text-[10px] tracking-[0.06em] text-ink-3 uppercase">
        {label}
      </dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function numOrDash(n: number): string {
  return n > 0 ? n.toLocaleString("en-US") : "—";
}

function moneyOrDash(n: number): string {
  return n > 0 ? dollars.format(n) : "—";
}
