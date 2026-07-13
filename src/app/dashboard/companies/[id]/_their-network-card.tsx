"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, Textarea } from "@/components/ui";

import {
  addKeyRelationship,
  updateKeyRelationship,
  deleteKeyRelationship,
  linkKeyRelationship,
  addRelationshipAsProspect,
} from "./actions";

// Their Network card (profile-parity P6b). Only rendered for strategic_partner
// companies. The key external contacts this partner can connect the network
// with — add/edit/remove, plus link each one to an existing CRM company or
// promote it into a fresh prospect. All writes go through the withOrg-scoped
// key-relationship actions; this holds only local UI state (which row is open /
// whether the add form is showing). Emails feed meeting matching.

export type KeyRelationshipRow = {
  id: string;
  name: string;
  title: string;
  org: string;
  relevance: string;
  email: string;
  phone: string;
  linkedCompanyId: string | null;
  linkedCompanyName: string | null;
};

// The companies offered in the link dropdown (this org's, minus the partner).
export type LinkOption = { id: string; name: string };

export function TheirNetworkCard({
  companyId,
  relationships,
  linkOptions,
}: {
  companyId: string;
  relationships: KeyRelationshipRow[];
  linkOptions: LinkOption[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Their network"
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

      <p className="border-b border-line px-4 py-2 text-[11px] text-ink-3 italic">
        Key external contacts this partner can connect you with. Emails feed
        meeting matching.
      </p>

      {adding ? (
        <div className="border-b border-line p-4">
          <RelationshipForm
            action={addKeyRelationship}
            hidden={{ companyId }}
            submitLabel="Add relationship"
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {relationships.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No relationships captured yet. Use “Add” to record a contact this
          partner can introduce you to.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {relationships.map((r) => (
            <RelationshipItem
              key={r.id}
              relationship={r}
              linkOptions={linkOptions}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function RelationshipItem({
  relationship,
  linkOptions,
}: {
  relationship: KeyRelationshipRow;
  linkOptions: LinkOption[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="p-4">
        <RelationshipForm
          action={updateKeyRelationship}
          hidden={{ relationshipId: relationship.id }}
          defaults={relationship}
          submitLabel="Save changes"
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  const meta = [relationship.title, relationship.org].filter(Boolean).join(" · ");
  const contact = [relationship.email, relationship.phone]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-ink">{relationship.name}</div>
          {meta ? <div className="mt-0.5 text-[11px] text-ink-3">{meta}</div> : null}
          {contact ? (
            <div className="mt-0.5 text-[11px] text-ink-3">{contact}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            Edit
          </button>
          <form action={deleteKeyRelationship}>
            <input type="hidden" name="relationshipId" value={relationship.id} />
            <button
              type="submit"
              className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
            >
              Remove
            </button>
          </form>
        </div>
      </div>

      {relationship.relevance ? (
        <p className="text-xs whitespace-pre-wrap text-ink-2">
          {relationship.relevance}
        </p>
      ) : null}

      <RelationshipLink relationship={relationship} linkOptions={linkOptions} />
    </li>
  );
}

function RelationshipLink({
  relationship,
  linkOptions,
}: {
  relationship: KeyRelationshipRow;
  linkOptions: LinkOption[];
}) {
  if (relationship.linkedCompanyId) {
    return (
      <div className="flex items-center gap-2">
        <a
          href={`/dashboard/companies/${relationship.linkedCompanyId}`}
          className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:text-gold"
        >
          → {relationship.linkedCompanyName ?? "Linked company"}
        </a>
        <form action={linkKeyRelationship}>
          <input type="hidden" name="relationshipId" value={relationship.id} />
          <input type="hidden" name="linkedCompanyId" value="" />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
          >
            Unlink
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {linkOptions.length > 0 ? (
        <form action={linkKeyRelationship} className="flex items-center gap-1">
          <input type="hidden" name="relationshipId" value={relationship.id} />
          <select
            name="linkedCompanyId"
            defaultValue=""
            required
            className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-2"
          >
            <option value="" disabled>
              Link to CRM…
            </option>
            {linkOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            Link
          </button>
        </form>
      ) : null}
      <form action={addRelationshipAsProspect}>
        <input type="hidden" name="relationshipId" value={relationship.id} />
        <button
          type="submit"
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          + Add to CRM
        </button>
      </form>
    </div>
  );
}

function RelationshipForm({
  action,
  hidden,
  defaults,
  submitLabel,
  onDone,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: Record<string, string>;
  defaults?: KeyRelationshipRow;
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
          label="Name"
          defaultValue={defaults?.name ?? ""}
          required
        />
        <Field
          name="title"
          label="Title / role"
          defaultValue={defaults?.title ?? ""}
        />
        <Field
          name="org"
          label="Organization"
          defaultValue={defaults?.org ?? ""}
        />
        <Field
          name="email"
          label="Email"
          type="email"
          defaultValue={defaults?.email ?? ""}
        />
        <Field
          name="phone"
          label="Phone"
          defaultValue={defaults?.phone ?? ""}
        />
      </div>

      <Textarea
        name="relevance"
        label="Why relevant"
        defaultValue={defaults?.relevance ?? ""}
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
