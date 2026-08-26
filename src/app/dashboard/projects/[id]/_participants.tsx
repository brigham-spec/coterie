"use client";

import Link from "next/link";
import { useState } from "react";

import {
  Button,
  Card,
  CardHeader,
  Field,
  SelectField,
  StatusBadge,
} from "@/components/ui";
import {
  PROJECT_LINK_ROLE_GROUPS,
  projectLinkRoleLabel,
} from "@/lib/project-roles";

import { addParticipant, updateParticipant, removeParticipant } from "../actions";

// The unified Participant roster (the merge of the old "Participants" company
// links and the "Professional Team" free-text members). Each row is one
// participant on the project — a network COMPANY in a role with an optional
// primary CONTACT, OR an off-network person captured as free text — and a company
// may appear more than once (different roles). Writes go through the withOrg-scoped
// project actions; this holds only local UI state (which form is open / editing).

export type ParticipantRow = {
  id: string;
  role: string;
  companyId: string | null;
  companyName: string | null;
  // The company's lifecycle status, shown as a badge for on-network rows.
  companyStatus: string | null;
  // The primary contact at that company (a real FK now), linking to the profile.
  contactId: string | null;
  contactName: string | null;
  // Off-network fallbacks (empty for on-network rows).
  name: string;
  org: string;
  email: string;
};

export type ParticipantCompanyOption = { id: string; name: string };
export type ParticipantContactOption = {
  id: string;
  name: string;
  companyId: string;
};

export function ParticipantsCard({
  projectId,
  participants,
  companies,
  contacts,
}: {
  projectId: string;
  participants: ParticipantRow[];
  companies: ParticipantCompanyOption[];
  contacts: ParticipantContactOption[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Participants"
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
          <ParticipantForm
            projectId={projectId}
            companies={companies}
            contacts={contacts}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {participants.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No participants yet. Use “Add” to link a company or add an off-network
          person.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {participants.map((p) => (
            <ParticipantItem
              key={p.id}
              projectId={projectId}
              participant={p}
              companies={companies}
              contacts={contacts}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ParticipantItem({
  projectId,
  participant,
  companies,
  contacts,
}: {
  projectId: string;
  participant: ParticipantRow;
  companies: ParticipantCompanyOption[];
  contacts: ParticipantContactOption[];
}) {
  const [editing, setEditing] = useState(false);
  const label =
    participant.companyName || participant.name || participant.org || "—";

  if (editing) {
    return (
      <li className="p-4">
        <ParticipantForm
          projectId={projectId}
          companies={companies}
          contacts={contacts}
          participant={participant}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {participant.companyId ? (
            <Link
              href={`/dashboard/companies/${participant.companyId}`}
              className="text-xs font-medium text-ink hover:text-gold hover:underline"
            >
              {label}
            </Link>
          ) : (
            <span className="text-xs font-medium text-ink">{label}</span>
          )}
          <span className="rounded-sm border border-line-2 bg-surface px-1.5 py-0.5 text-[10px] text-ink-2">
            {projectLinkRoleLabel(participant.role)}
          </span>
          {participant.companyStatus ? (
            <StatusBadge status={participant.companyStatus} />
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          {participant.contactId ? (
            <Link
              href={`/dashboard/contacts/${participant.contactId}`}
              className="hover:text-gold hover:underline"
            >
              {participant.contactName || "Primary contact"}
            </Link>
          ) : participant.companyId ? (
            <span className="text-ink-3">No primary contact</span>
          ) : null}
          {participant.org && !participant.companyId ? (
            <span>{participant.org}</span>
          ) : null}
          {participant.email ? (
            <a href={`mailto:${participant.email}`} className="hover:text-gold">
              {participant.email}
            </a>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          Edit
        </button>
        <form action={removeParticipant}>
          <input type="hidden" name="linkId" value={participant.id} />
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

function RoleSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <SelectField name="role" label="Role" defaultValue={defaultValue} required>
      <option value="" disabled>
        Select a role…
      </option>
      {PROJECT_LINK_ROLE_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </SelectField>
  );
}

function ParticipantForm({
  projectId,
  companies,
  contacts,
  participant,
  onDone,
}: {
  projectId: string;
  companies: ParticipantCompanyOption[];
  contacts: ParticipantContactOption[];
  participant?: ParticipantRow;
  onDone: () => void;
}) {
  const action = participant ? updateParticipant : addParticipant;
  // An existing off-network row (no company, but free-text data) opens in
  // off-network mode; everything else defaults to the company picker.
  const [mode, setMode] = useState<"company" | "offnetwork">(
    participant && participant.companyId === null
      ? "offnetwork"
      : "company",
  );
  // Track the chosen company so the contact picker can filter to its contacts.
  const [companyId, setCompanyId] = useState(participant?.companyId ?? "");
  const companyContacts = contacts.filter((c) => c.companyId === companyId);

  const toggleClass = (active: boolean) =>
    `rounded-sm border px-2.5 py-1.5 text-[11px] font-medium ${
      active
        ? "border-ink bg-ink text-white"
        : "border-line-2 bg-surface text-ink-2 hover:border-ink-3"
    }`;

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="projectId" value={projectId} />
      {participant ? (
        <input type="hidden" name="linkId" value={participant.id} />
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("company")}
          className={toggleClass(mode === "company")}
        >
          Network company
        </button>
        <button
          type="button"
          onClick={() => setMode("offnetwork")}
          className={toggleClass(mode === "offnetwork")}
        >
          Off-network
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <RoleSelect defaultValue={participant?.role ?? ""} />

        {mode === "company" ? (
          <>
            <SelectField
              name="companyId"
              label="Company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              required
            >
              <option value="" disabled>
                Select a company…
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              // Remount when the company changes so the contact selection resets
              // to the (filtered) default rather than keeping a now-invalid pick.
              key={companyId}
              name="contactId"
              label="Primary contact (optional)"
              defaultValue={participant?.contactId ?? ""}
              className="col-span-2"
              disabled={companyId === ""}
            >
              <option value="">No primary contact</option>
              {companyContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          </>
        ) : (
          <>
            <Field
              name="name"
              label="Name"
              placeholder="Jane Doe"
              defaultValue={participant?.name}
            />
            <Field
              name="org"
              label="Organization"
              placeholder="Firm or company"
              defaultValue={participant?.org}
            />
            <Field
              name="email"
              label="Email"
              type="email"
              placeholder="jane@firm.com"
              defaultValue={participant?.email}
              className="col-span-2"
            />
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {participant ? "Save" : "Add participant"}
        </Button>
      </div>
    </form>
  );
}
