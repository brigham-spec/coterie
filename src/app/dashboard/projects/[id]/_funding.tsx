"use client";

import { useActionState, useState } from "react";

import { Button, Card, CardHeader, Field, SelectField, Textarea } from "@/components/ui";
import { FUNDING_CATEGORY_DEFS, FUNDING_STATUS_DEFS } from "@/lib/funding";

import {
  addFundingSource,
  updateFundingSource,
  updateFundingStatus,
  deleteFundingSource,
  suggestFundingSources,
  type FundingSuggestState,
} from "../actions";

// Funding Sources & Grants card (projects-module parity; ported from the
// prototype's Funding Sources & Grants section, Coterie.html:10228). Tracks the
// state/federal/alternative capital programs a project is pursuing. "AI Suggest"
// runs the eligibility-gated engine to identify qualifying programs (ephemeral —
// the operator "Tracks" the ones they want), and rows can also be added manually.
// All writes go through the withOrg-scoped actions; the Anthropic key never
// reaches the browser. This holds only local UI state (which forms are open).

export type FundingRow = {
  id: string;
  name: string;
  agency: string;
  category: string;
  estimatedBenefit: string;
  status: string;
  rationale: string;
  action: string;
  notes: string;
  aiSuggested: boolean;
};

// Literal classes so Tailwind's JIT emits them (keyed by the funding vocabulary).
const categoryBadge: Record<string, string> = {
  Grant: "bg-gold-bg text-gold-ink",
  Loan: "bg-teal-bg text-teal-ink",
  "Tax Benefit": "bg-purple-bg text-purple-ink",
  Bond: "bg-slate-bg text-slate-ink",
  Equity: "bg-amber-bg text-amber-ink",
};
const statusText: Record<string, string> = {
  Identified: "text-ink-3",
  Researching: "text-amber-ink",
  Applied: "text-gold-ink",
  Awarded: "text-teal-ink font-semibold",
  Declined: "text-red-ink",
};

const suggestInitial: FundingSuggestState = { status: "idle" };

// A suggestion is "already tracked" when a row's name overlaps it (matches the
// prototype's loose 12-char prefix check).
function isTracked(rows: FundingRow[], name: string): boolean {
  const needle = name.toLowerCase().slice(0, 12);
  return rows.some((r) => r.name.toLowerCase().includes(needle));
}

export function FundingCard({
  projectId,
  sources,
}: {
  projectId: string;
  sources: FundingRow[];
}) {
  const [adding, setAdding] = useState(false);
  const [suggestState, suggestAction, suggesting] = useActionState(
    suggestFundingSources,
    suggestInitial,
  );

  const suggestions =
    suggestState.status === "ok" ? suggestState.suggestions : [];

  return (
    <Card>
      <CardHeader
        title="Funding sources & grants"
        action={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {adding ? "Close" : "+ Add"}
            </button>
            <form action={suggestAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <Button type="submit" variant="gold" disabled={suggesting}>
                {suggesting ? "Identifying…" : "AI Suggest"}
              </Button>
            </form>
          </div>
        }
      />

      <p className="border-b border-line px-4 py-2 text-[10.5px] text-ink-3">
        State, federal, and alternative capital programs for this project.
      </p>

      {suggestState.status === "error" ? (
        <p className="border-b border-line px-4 py-3 text-xs text-red-ink">
          {suggestState.message}
        </p>
      ) : null}

      {suggestState.status === "ok" ? (
        suggestions.length === 0 ? (
          <p className="border-b border-line px-4 py-3 text-xs text-ink-3">
            No qualifying programs identified. Add project details (description,
            type, county, value) and try again, or add one manually.
          </p>
        ) : (
          <div className="border-b border-line bg-surface-2 px-4 py-3">
            <div className="mb-2 text-[9px] font-medium tracking-[0.08em] text-gold-ink uppercase">
              AI-identified opportunities ({suggestions.length})
            </div>
            <ul className="flex flex-col gap-2">
              {suggestions.map((s, i) => {
                const tracked = isTracked(sources, s.name);
                return (
                  <li
                    key={`${s.name}-${i}`}
                    className="flex items-start justify-between gap-3 rounded-sm border border-line bg-surface p-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11.5px] font-medium text-ink">
                          {s.name}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                            categoryBadge[s.category] ?? "bg-surface-2 text-ink-3"
                          }`}
                        >
                          {s.category}
                        </span>
                        {s.estimatedBenefit ? (
                          <span className="text-[10px] text-ink-3">
                            {s.estimatedBenefit}
                          </span>
                        ) : null}
                      </div>
                      {s.rationale ? (
                        <p className="mt-1 text-[10px] text-ink-3">{s.rationale}</p>
                      ) : null}
                    </div>
                    {tracked ? (
                      <span className="shrink-0 pt-1 text-[9px] font-semibold text-teal-ink">
                        ✓ Added
                      </span>
                    ) : (
                      <form action={addFundingSource} className="shrink-0">
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="name" value={s.name} />
                        <input type="hidden" name="agency" value={s.agency} />
                        <input type="hidden" name="category" value={s.category} />
                        <input
                          type="hidden"
                          name="estimatedBenefit"
                          value={s.estimatedBenefit}
                        />
                        <input type="hidden" name="rationale" value={s.rationale} />
                        <input type="hidden" name="action" value={s.action} />
                        <input type="hidden" name="status" value="Identified" />
                        <input type="hidden" name="aiSuggested" value="true" />
                        <button
                          type="submit"
                          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
                        >
                          + Track
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )
      ) : null}

      {adding ? (
        <div className="border-b border-line p-4">
          <FundingForm projectId={projectId} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      {sources.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No funding sources tracked yet — run AI Suggest to identify
          opportunities, or add one manually.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {sources.map((s) => (
            <FundingItem key={s.id} projectId={projectId} source={s} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function FundingItem({
  projectId,
  source,
}: {
  projectId: string;
  source: FundingRow;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="p-4">
        <FundingForm
          projectId={projectId}
          source={source}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink">{source.name}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
              categoryBadge[source.category] ?? "bg-surface-2 text-ink-3"
            }`}
          >
            {source.category}
          </span>
          {source.aiSuggested ? (
            <span className="text-[9px] text-ink-3">✦ AI</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          {source.agency ? <span>{source.agency}</span> : null}
          {source.estimatedBenefit ? (
            <span className="font-medium text-ink-2">{source.estimatedBenefit}</span>
          ) : null}
        </div>
        {source.rationale ? (
          <p className="mt-1 text-[10.5px] text-ink-3 italic">{source.rationale}</p>
        ) : null}
        {source.notes ? (
          <p className="mt-1 text-[10.5px] text-ink-2">{source.notes}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <form action={updateFundingStatus}>
          <input type="hidden" name="fundingSourceId" value={source.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <select
            name="status"
            defaultValue={source.status}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={`rounded-sm border border-line bg-surface px-1.5 py-1 text-[10px] ${
              statusText[source.status] ?? "text-ink"
            }`}
          >
            {FUNDING_STATUS_DEFS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </form>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          Edit
        </button>
        <form action={deleteFundingSource}>
          <input type="hidden" name="fundingSourceId" value={source.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
          >
            Remove
          </button>
        </form>
      </div>
    </li>
  );
}

function FundingForm({
  projectId,
  source,
  onDone,
}: {
  projectId: string;
  source?: FundingRow;
  onDone: () => void;
}) {
  const action = source ? updateFundingSource : addFundingSource;

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="projectId" value={projectId} />
      {source ? (
        <>
          <input type="hidden" name="fundingSourceId" value={source.id} />
          {/* Preserve AI-provided rationale/action across an operator edit. */}
          <input type="hidden" name="rationale" value={source.rationale} />
          <input type="hidden" name="action" value={source.action} />
        </>
      ) : null}

      <Field
        name="name"
        label="Program name"
        placeholder="e.g. Restore NY Communities Initiative"
        defaultValue={source?.name}
        required
      />

      <div className="grid grid-cols-2 gap-4">
        <Field
          name="agency"
          label="Agency"
          placeholder="e.g. Empire State Development"
          defaultValue={source?.agency}
        />
        <Field
          name="estimatedBenefit"
          label="Estimated benefit"
          placeholder="e.g. Up to $2M"
          defaultValue={source?.estimatedBenefit}
        />
        <SelectField
          name="category"
          label="Category"
          defaultValue={source?.category ?? "Grant"}
        >
          {FUNDING_CATEGORY_DEFS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="status"
          label="Status"
          defaultValue={source?.status ?? "Identified"}
        >
          {FUNDING_STATUS_DEFS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
      </div>

      <Textarea
        name="notes"
        label="Notes"
        placeholder="Contacts, deadlines, next steps…"
        defaultValue={source?.notes}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {source ? "Save" : "Add funding source"}
        </Button>
      </div>
    </form>
  );
}
