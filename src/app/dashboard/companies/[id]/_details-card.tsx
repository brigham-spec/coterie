"use client";

import { useState } from "react";

import {
  Button,
  Card,
  CardHeader,
  Field,
  SelectField,
  Textarea,
} from "@/components/ui";
import { COMPANY_STATUS_DEFS } from "@/lib/company-statuses";
import { ORG_TAGS } from "@/lib/tags";

import { updateCompany, changeCompanyStatus } from "./actions";

// Editable Details card (profile-parity P1). The company detail page is
// otherwise read-only; this owns the view/edit toggle for the company's own
// fields plus the lifecycle shortcuts (Convert / Archive / Restore). All writes
// go through the withOrg-scoped server actions — this holds only local UI state
// (whether the form is open). After a successful save the server revalidates and
// this closes the form.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type DetailsCompany = {
  id: string;
  status: string;
  tier: string | null;
  temperature: number | null;
  industry: string;
  annualValue: number;
  website: string | null;
  emailDomain: string | null;
  source: string | null;
  memberSince: number | null;
  dealSize: string | null;
  counties: string[];
  lookingFor: string | null;
  canOffer: string | null;
  agencyContacts: string | null;
  notes: string;
  networkTags: string[];
  ownerName: string | null;
  ownerUserId: string | null;
};

export type StaffOption = { id: string; name: string };

export function DetailsCard({
  company,
  staff,
}: {
  company: DetailsCompany;
  staff: StaffOption[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditForm
        company={company}
        staff={staff}
        onDone={() => setEditing(false)}
      />
    );
  }
  return <ReadView company={company} onEdit={() => setEditing(true)} />;
}

function ReadView({
  company,
  onEdit,
}: {
  company: DetailsCompany;
  onEdit: () => void;
}) {
  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Industry", value: company.industry },
    { label: "Tier", value: company.tier },
    { label: "Owner", value: company.ownerName },
    {
      label: "Annual value",
      value: currency.format(company.annualValue),
    },
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

  const narrative: Array<{ label: string; value: string | null }> = [
    { label: "Looking for", value: company.lookingFor },
    { label: "Can offer", value: company.canOffer },
    { label: "Agency contacts", value: company.agencyContacts },
  ];
  const hasNarrative = narrative.some((n) => n.value);

  return (
    <Card>
      <CardHeader
        title="Details"
        action={
          <button
            type="button"
            onClick={onEdit}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            Edit
          </button>
        }
      />
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
          <p className="text-xs whitespace-pre-wrap text-ink-2">
            {company.notes}
          </p>
        </div>
      ) : null}
      <LifecycleBar company={company} />
    </Card>
  );
}

// Contextual lifecycle shortcuts, mirroring the prototype footer: prospects can
// convert to member, active relationships can be archived, former ones restored.
function LifecycleBar({ company }: { company: DetailsCompany }) {
  const actions: Array<{ label: string; status: string; variant?: "primary" }> =
    [];
  if (company.status === "prospect")
    actions.push({ label: "Convert to member", status: "member", variant: "primary" });
  if (company.status !== "former")
    actions.push({ label: "Archive", status: "former" });
  if (company.status === "former")
    actions.push({ label: "Restore to prospect", status: "prospect" });

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
      {actions.map((a) => (
        <form key={a.status} action={changeCompanyStatus}>
          <input type="hidden" name="companyId" value={company.id} />
          <input type="hidden" name="status" value={a.status} />
          <Button type="submit" variant={a.variant}>
            {a.label}
          </Button>
        </form>
      ))}
    </div>
  );
}

function EditForm({
  company,
  staff,
  onDone,
}: {
  company: DetailsCompany;
  staff: StaffOption[];
  onDone: () => void;
}) {
  const tagSet = new Set(company.networkTags);

  return (
    <Card>
      <CardHeader title="Edit details" />
      <form
        action={async (fd) => {
          await updateCompany(fd);
          onDone();
        }}
        className="flex flex-col gap-4 p-4"
      >
        <input type="hidden" name="companyId" value={company.id} />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <SelectField
            name="status"
            label="Status"
            defaultValue={company.status}
          >
            {COMPANY_STATUS_DEFS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectField>
          <Field
            name="industry"
            label="Industry"
            defaultValue={company.industry}
            required
          />
          <Field name="tier" label="Tier" defaultValue={company.tier ?? ""} />
          <SelectField
            name="ownerUserId"
            label="Owner"
            defaultValue={company.ownerUserId ?? ""}
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <Field
            name="annualValue"
            label="Annual value ($)"
            type="number"
            min={0}
            step="1"
            defaultValue={String(company.annualValue)}
          />
          <Field
            name="temperature"
            label="Temperature (0–100)"
            type="number"
            min={0}
            max={100}
            defaultValue={company.temperature == null ? "" : String(company.temperature)}
          />
          <Field
            name="memberSince"
            label="Member since (year)"
            type="number"
            defaultValue={company.memberSince == null ? "" : String(company.memberSince)}
          />
          <Field
            name="dealSize"
            label="Deal size"
            defaultValue={company.dealSize ?? ""}
          />
          <Field
            name="source"
            label="Source"
            defaultValue={company.source ?? ""}
          />
          <Field
            name="emailDomain"
            label="Email domain"
            defaultValue={company.emailDomain ?? ""}
          />
          <Field
            name="website"
            label="Website"
            defaultValue={company.website ?? ""}
          />
          <Field
            name="counties"
            label="Counties (comma-separated)"
            defaultValue={company.counties.join(", ")}
            className="col-span-2 sm:col-span-3"
          />
        </div>

        <Textarea
          name="lookingFor"
          label="Looking for"
          defaultValue={company.lookingFor ?? ""}
        />
        <Textarea
          name="canOffer"
          label="Can offer"
          defaultValue={company.canOffer ?? ""}
        />
        <Textarea
          name="agencyContacts"
          label="Agency contacts"
          defaultValue={company.agencyContacts ?? ""}
        />
        <Textarea
          name="notes"
          label="Notes"
          defaultValue={company.notes}
        />

        <div>
          <span className="mb-1.5 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
            Network tags
          </span>
          <div className="flex flex-wrap gap-2">
            {ORG_TAGS.map((t) => (
              <label
                key={t.key}
                title={t.desc}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line-2 bg-surface px-2.5 py-1 text-[11px] text-ink-2 has-[:checked]:border-gold-line has-[:checked]:bg-gold-bg has-[:checked]:text-gold-ink"
              >
                <input
                  type="checkbox"
                  name="networkTags"
                  value={t.key}
                  defaultChecked={tagSet.has(t.key)}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}
