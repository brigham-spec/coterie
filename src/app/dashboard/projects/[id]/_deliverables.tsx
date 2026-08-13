"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, StatusBadge } from "@/components/ui";

import {
  addProjectDeliverable,
  updateProjectDeliverable,
  deleteProjectDeliverable,
  editProjectDeliverable,
} from "../actions";

// Project deliverables card — the follow-ups owed on a project. A deliverable is
// an action_item (owner-XOR: staff owner = "we owe", network contact = "they
// owe"), so the owner select carries both direction and identity. All writes go
// through the withOrg-scoped project actions; this holds only local UI state
// (whether the add form is open). The owner option value encodes direction:id,
// which the form splits into the `direction`/`ownerId` fields the action expects.

export type DeliverableRow = {
  id: string;
  text: string;
  status: string;
  direction: "we_owe" | "they_owe";
  // The owner's id (staff user or contact), used to prefill the owner picker when
  // editing. Combined with direction it forms the "direction:id" option value.
  ownerId: string;
  ownerName: string;
};

export type OwnerOption = { id: string; name: string };
export type ContactOption = { id: string; name: string; companyName: string };

const DIRECTION_LABEL: Record<DeliverableRow["direction"], string> = {
  we_owe: "We owe",
  they_owe: "They owe",
};

export function DeliverablesCard({
  projectId,
  deliverables,
  staff,
  contacts,
}: {
  projectId: string;
  deliverables: DeliverableRow[];
  staff: OwnerOption[];
  contacts: ContactOption[];
}) {
  const [adding, setAdding] = useState(false);
  const canAdd = staff.length > 0 || contacts.length > 0;

  return (
    <Card>
      <CardHeader
        title="Deliverables"
        action={
          canAdd ? (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {adding ? "Close" : "Add"}
            </button>
          ) : null
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <DeliverableForm
            projectId={projectId}
            staff={staff}
            contacts={contacts}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {deliverables.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          {canAdd
            ? "No deliverables yet. Use “Add” to track what’s owed on this project."
            : "Link a company (with a contact) or add staff to track deliverables."}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {deliverables.map((d) => (
            <DeliverableItem
              key={d.id}
              projectId={projectId}
              deliverable={d}
              staff={staff}
              contacts={contacts}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeliverableItem({
  projectId,
  deliverable,
  staff,
  contacts,
}: {
  projectId: string;
  deliverable: DeliverableRow;
  staff: OwnerOption[];
  contacts: ContactOption[];
}) {
  const [editing, setEditing] = useState(false);
  const done = deliverable.status === "done";
  const nextStatus = done ? "open" : "done";

  if (editing) {
    return (
      <li className="p-4">
        <form
          action={async (fd) => {
            // The owner option encodes "direction:id"; split it into the fields
            // the action validates.
            const owner = String(fd.get("owner") ?? "");
            const sep = owner.indexOf(":");
            fd.set("direction", sep === -1 ? "" : owner.slice(0, sep));
            fd.set("ownerId", sep === -1 ? "" : owner.slice(sep + 1));
            await editProjectDeliverable(fd);
            setEditing(false);
          }}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="id" value={deliverable.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <Field
            name="text"
            label="Deliverable"
            defaultValue={deliverable.text}
            required
          />
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
              Owner
            </span>
            <select
              name="owner"
              defaultValue={`${deliverable.direction}:${deliverable.ownerId}`}
              required
              className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink"
            >
              <option value="" disabled>
                Select an owner…
              </option>
              <DeliverableOwnerOptions staff={staff} contacts={contacts} />
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p
          className={
            done
              ? "text-xs text-ink-3 line-through"
              : "text-xs text-ink"
          }
        >
          {deliverable.text}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-3">
          <span className="rounded-sm border border-line-2 bg-surface px-1.5 py-0.5 text-[10px] text-ink-2">
            {DIRECTION_LABEL[deliverable.direction]}
          </span>
          <span>{deliverable.ownerName}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={deliverable.status} />
        <form action={updateProjectDeliverable}>
          <input type="hidden" name="id" value={deliverable.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="status" value={nextStatus} />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            {done ? "Reopen" : "Done"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
        >
          Edit
        </button>
        <form action={deleteProjectDeliverable}>
          <input type="hidden" name="id" value={deliverable.id} />
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

function DeliverableForm({
  projectId,
  staff,
  contacts,
  onDone,
}: {
  projectId: string;
  staff: OwnerOption[];
  contacts: ContactOption[];
  onDone: () => void;
}) {
  return (
    <form
      action={async (fd) => {
        // The owner option encodes "direction:id"; split it into the fields the
        // action validates.
        const owner = String(fd.get("owner") ?? "");
        const sep = owner.indexOf(":");
        fd.set("direction", sep === -1 ? "" : owner.slice(0, sep));
        fd.set("ownerId", sep === -1 ? "" : owner.slice(sep + 1));
        await addProjectDeliverable(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="projectId" value={projectId} />

      <Field
        name="text"
        label="Deliverable"
        placeholder="e.g. Send the IDA application draft"
        required
      />

      <label className="block">
        <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
          Owner
        </span>
        <select
          name="owner"
          defaultValue=""
          required
          className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink"
        >
          <option value="" disabled>
            Select an owner…
          </option>
          <DeliverableOwnerOptions staff={staff} contacts={contacts} />
        </select>
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Add deliverable
        </Button>
      </div>
    </form>
  );
}

// The owner picker's option groups, shared by the add form and the per-item edit
// form. The option value encodes "direction:id" — "we_owe:<userId>" for staff,
// "they_owe:<contactId>" for a network contact — which each form splits into the
// direction/ownerId fields the action validates.
function DeliverableOwnerOptions({
  staff,
  contacts,
}: {
  staff: OwnerOption[];
  contacts: ContactOption[];
}) {
  return (
    <>
      {staff.length > 0 ? (
        <optgroup label="We owe (staff)">
          {staff.map((s) => (
            <option key={`u-${s.id}`} value={`we_owe:${s.id}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {contacts.length > 0 ? (
        <optgroup label="They owe (network)">
          {contacts.map((c) => (
            <option key={`c-${c.id}`} value={`they_owe:${c.id}`}>
              {c.name} — {c.companyName}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}
