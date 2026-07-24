"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, SelectField } from "@/components/ui";

import { logCommitment } from "./actions";

// Global "+ Log Commitment" (parity: manual obligation 12623). Records a follow-up
// that never came from a meeting: pick a direction, an owner (our staff for "we
// owe", a network contact for "they owe"), and an optional due date. The owner
// picker swaps with the direction; the server action re-validates the owner in
// the correct XOR column, so the client selection is never trusted.

export interface StaffOption {
  id: string;
  name: string;
}
export interface ContactOption {
  id: string;
  label: string;
}

export function LogCommitment({
  staff,
  contacts,
}: {
  staff: StaffOption[];
  contacts: ContactOption[];
}) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"we_owe" | "they_owe">("we_owe");

  if (!open) {
    return (
      <Card>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full px-4 py-3 text-left text-xs text-ink-3 hover:text-ink"
        >
          + Log commitment
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Log commitment" />
      <form
        action={async (fd) => {
          await logCommitment(fd);
          setOpen(false);
        }}
        className="grid grid-cols-2 gap-4 p-4"
      >
        <SelectField
          name="direction"
          label="Direction"
          value={direction}
          onChange={(e) => setDirection(e.target.value as "we_owe" | "they_owe")}
        >
          <option value="we_owe">We owe</option>
          <option value="they_owe">They owe us</option>
        </SelectField>
        {direction === "we_owe" ? (
          <SelectField
            key="staff"
            name="ownerId"
            label="Owner (staff)"
            defaultValue={staff[0]?.id ?? ""}
            required
          >
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <SelectField
            key="contact"
            name="ownerId"
            label="Owed by (contact)"
            defaultValue=""
            required
          >
            <option value="" disabled>
              Select a contact…
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </SelectField>
        )}
        <Field
          name="text"
          label="Commitment"
          placeholder="What is owed?"
          required
          maxLength={500}
          className="col-span-2"
        />
        <Field name="dueDate" label="Due date" type="date" />
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Log commitment
          </Button>
        </div>
      </form>
    </Card>
  );
}
