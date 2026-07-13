"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, Textarea } from "@/components/ui";

import {
  addAffiliation,
  updateAffiliation,
  deleteAffiliation,
} from "./actions";

// Additional Companies & Affiliations card (profile-parity P5). A member often
// wears more than one hat — a separate business line with its own offer/need
// profile. This owns the add/edit/remove surface for those, mirroring the
// prototype's inline editor. All writes go through the withOrg-scoped affiliation
// actions; this holds only local UI state (which row is open / whether the add
// form is showing). After a successful save the server revalidates and the form
// closes.

export type AffiliationRow = {
  id: string;
  name: string;
  role: string;
  industry: string;
  website: string;
  canOffer: string;
  lookingFor: string;
  counties: string;
  dealSize: string;
};

export function AffiliationsCard({
  companyId,
  affiliations,
}: {
  companyId: string;
  affiliations: AffiliationRow[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Additional companies & affiliations"
        action={
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            {adding ? "Close" : "Add"}
          </button>
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <AffiliationForm
            action={addAffiliation}
            hidden={{ companyId }}
            submitLabel="Add affiliation"
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {affiliations.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No other affiliations yet. Use “Add” to capture another company or
          capacity this member represents.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {affiliations.map((a) => (
            <AffiliationItem key={a.id} affiliation={a} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AffiliationItem({ affiliation }: { affiliation: AffiliationRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="p-4">
        <AffiliationForm
          action={updateAffiliation}
          hidden={{ affiliationId: affiliation.id }}
          defaults={affiliation}
          submitLabel="Save changes"
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const meta = [affiliation.industry, affiliation.counties, affiliation.dealSize]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-ink">
              {affiliation.name}
            </span>
            {affiliation.role ? (
              <span className="text-[11px] text-ink-3">{affiliation.role}</span>
            ) : null}
            {affiliation.website ? (
              <a
                href={affiliation.website}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-ink-3 hover:text-gold hover:underline"
              >
                Website
              </a>
            ) : null}
          </div>
          {meta ? <div className="mt-0.5 text-[11px] text-ink-3">{meta}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            Edit
          </button>
          <form action={deleteAffiliation}>
            <input type="hidden" name="affiliationId" value={affiliation.id} />
            <button
              type="submit"
              className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
            >
              Remove
            </button>
          </form>
        </div>
      </div>

      {affiliation.canOffer ? (
        <div className="text-xs text-ink-2">
          <span className="text-[10px] tracking-[0.04em] text-ink-3 uppercase">
            Can offer
          </span>
          <p className="whitespace-pre-wrap">{affiliation.canOffer}</p>
        </div>
      ) : null}
      {affiliation.lookingFor ? (
        <div className="text-xs text-ink-2">
          <span className="text-[10px] tracking-[0.04em] text-ink-3 uppercase">
            Looking for
          </span>
          <p className="whitespace-pre-wrap">{affiliation.lookingFor}</p>
        </div>
      ) : null}
    </li>
  );
}

function AffiliationForm({
  action,
  hidden,
  defaults,
  submitLabel,
  onDone,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  defaults?: AffiliationRow;
  submitLabel: string;
  onDone: () => void;
}) {
  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="grid grid-cols-2 gap-4">
        <Field
          name="name"
          label="Company"
          defaultValue={defaults?.name ?? ""}
          required
        />
        <Field name="role" label="Role" defaultValue={defaults?.role ?? ""} />
        <Field
          name="industry"
          label="Industry"
          defaultValue={defaults?.industry ?? ""}
        />
        <Field
          name="website"
          label="Website"
          defaultValue={defaults?.website ?? ""}
        />
        <Field
          name="counties"
          label="Geography"
          defaultValue={defaults?.counties ?? ""}
        />
        <Field
          name="dealSize"
          label="Deal size"
          defaultValue={defaults?.dealSize ?? ""}
        />
      </div>

      <Textarea
        name="canOffer"
        label="Can offer"
        defaultValue={defaults?.canOffer ?? ""}
      />
      <Textarea
        name="lookingFor"
        label="Looking for"
        defaultValue={defaults?.lookingFor ?? ""}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
