"use client";

import { useState } from "react";

import { Button, Field, SelectField, Textarea, fieldControl } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";
import { COMPANY_STATUS_DEFS } from "@/lib/company-statuses";
import { autoAssignTier, type MemberTier } from "@/lib/member-tiers";
import { ORG_TAGS } from "@/lib/tags";

import { updateCompany, changeCompanyStatus, deleteCompany } from "./actions";

// Editable Details card (profile-parity P1 + S7 field parity). The company
// detail page is otherwise read-only; this owns the view/edit toggle for the
// company's own fields plus the lifecycle shortcuts (Convert / Archive /
// Restore). All writes go through the withOrg-scoped server actions — this holds
// only local UI state (whether the form is open, and the live tier preview).
// After a successful save the server revalidates and this closes the form.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export type DetailsCompany = {
  id: string;
  name: string;
  status: string;
  tier: string | null;
  tierLocked: boolean;
  likelihood: number | null;
  referredById: string | null;
  referredByExternal: string | null;
  referredByName: string | null;
  consulting: string | null;
  temperature: number | null;
  industry: string;
  annualValue: number;
  website: string | null;
  linkedin: string | null;
  emailDomain: string | null;
  primaryEmail: string | null;
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
export type ReferralOption = { id: string; name: string };

export function DetailsCard({
  company,
  staff,
  tierDefs,
  referralOptions,
}: {
  company: DetailsCompany;
  staff: StaffOption[];
  tierDefs: MemberTier[];
  referralOptions: ReferralOption[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditForm
        company={company}
        staff={staff}
        tierDefs={tierDefs}
        referralOptions={referralOptions}
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
  const referredBy =
    company.referredByName ?? company.referredByExternal ?? null;

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Industry", value: company.industry },
    {
      label: "Tier",
      value: company.tier
        ? company.tierLocked
          ? `${company.tier} (locked)`
          : company.tier
        : null,
    },
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
    { label: "Referred by", value: referredBy },
    { label: "Consulting", value: company.consulting },
    { label: "Source", value: company.source },
    { label: "Email", value: company.primaryEmail },
    { label: "Email domain", value: company.emailDomain },
    { label: "Website", value: company.website },
    { label: "LinkedIn", value: company.linkedin },
  ];

  const narrative: Array<{ label: string; value: string | null }> = [
    { label: "Looking for", value: company.lookingFor },
    { label: "Can offer", value: company.canOffer },
    { label: "Agency contacts", value: company.agencyContacts },
  ];
  const hasNarrative = narrative.some((n) => n.value);

  return (
    <CollapsibleCard
      id="company-details"
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
    >
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
      <DangerZone company={company} />
    </CollapsibleCard>
  );
}

// Permanent delete (Members 22). Distinct from Archive above (a reversible status
// change) — this destroys the record and everything hanging off it, so it sits
// behind a two-step inline confirm rather than firing on a single click. The
// server action redirects to the directory once the row is gone.
function DangerZone({ company }: { company: DetailsCompany }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="border-t border-line px-4 py-3">
      {confirming ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-2">
            Permanently delete <span className="font-medium">{company.name}</span>{" "}
            and all of its contacts, meetings, notes, and history? This cannot be
            undone.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <form action={deleteCompany}>
              <input type="hidden" name="companyId" value={company.id} />
              <Button type="submit" variant="danger">
                Delete permanently
              </Button>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
          >
            Delete company
          </button>
        </div>
      )}
    </div>
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
  tierDefs,
  referralOptions,
  onDone,
}: {
  company: DetailsCompany;
  staff: StaffOption[];
  tierDefs: MemberTier[];
  referralOptions: ReferralOption[];
  onDone: () => void;
}) {
  const tagSet = new Set(company.networkTags);
  const tierLabels = tierDefs.map((t) => t.label);

  // Offer the org's configured tiers, plus a blank "unset" option. If the stored
  // tier isn't in the configured list (a legacy value, or one since removed),
  // keep it selectable so an unrelated save doesn't silently drop it.
  const tierOptions =
    company.tier && !tierLabels.includes(company.tier)
      ? [company.tier, ...tierLabels]
      : tierLabels;

  // Track status / annualValue / lock so the tier field can preview the sliding
  // auto-assignment: a member's tier is derived from annual value unless the lock
  // is set. Locking (or any non-member status) reveals the manual <select>.
  const [status, setStatus] = useState(company.status);
  const [annualValue, setAnnualValue] = useState(String(company.annualValue));
  const [locked, setLocked] = useState(company.tierLocked);
  const autoTier = status === "member" && !locked;
  const previewTier = autoTier
    ? autoAssignTier(Number(annualValue) || 0, tierDefs)
    : null;

  return (
    <CollapsibleCard id="company-details" title="Edit details">
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
            value={status}
            onChange={(e) => setStatus(e.currentTarget.value)}
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
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
                Tier
              </span>
              {status === "member" ? (
                <button
                  type="button"
                  onClick={() => setLocked((v) => !v)}
                  className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
                >
                  {locked ? "Use auto" : "Set manually"}
                </button>
              ) : null}
            </div>
            {autoTier ? (
              <div className={fieldControl}>
                {previewTier ?? "—"}
                <span className="ml-1.5 text-[10px] text-ink-3">
                  auto from annual value
                </span>
              </div>
            ) : (
              <select
                name="tier"
                defaultValue={company.tier ?? ""}
                className={fieldControl}
              >
                <option value="">—</option>
                {tierOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </div>
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
            value={annualValue}
            onChange={(e) => setAnnualValue(e.currentTarget.value)}
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
            name="likelihood"
            label="Likelihood (1–5)"
            type="number"
            min={1}
            max={5}
            defaultValue={company.likelihood == null ? "" : String(company.likelihood)}
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
          <SelectField
            name="referredById"
            label="Referred by (in network)"
            defaultValue={company.referredById ?? ""}
          >
            <option value="">—</option>
            {referralOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </SelectField>
          <Field
            name="referredByExternal"
            label="Referred by (external)"
            defaultValue={company.referredByExternal ?? ""}
          />
          <Field
            name="consulting"
            label="Consulting / IDA"
            defaultValue={company.consulting ?? ""}
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
            name="linkedin"
            label="LinkedIn URL"
            defaultValue={company.linkedin ?? ""}
          />
          <Field
            name="counties"
            label="Counties (comma-separated)"
            defaultValue={company.counties.join(", ")}
            className="col-span-2 sm:col-span-3"
          />
        </div>

        {/* Tier lock is driven by the inline "Set manually / Use auto" toggle at
            the Tier field above; only members auto-assign, so a set lock on a
            non-member status is preserved here. Absent = unlocked. */}
        {locked ? <input type="hidden" name="tierLocked" value="on" /> : null}

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
    </CollapsibleCard>
  );
}
