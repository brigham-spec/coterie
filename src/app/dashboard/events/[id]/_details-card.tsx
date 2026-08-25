"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field, SelectField } from "@/components/ui";
import { EVENT_STAGES, EVENT_TYPES } from "@/lib/event-stages";

import { updateEventDetails } from "../actions";

// Editable Details card for an event (slice 11.7). The detail page is otherwise
// read-only; this owns the view/edit toggle for the event's core fields plus the
// optional venue attribution (the member company that owns/provided the venue and
// the contact who arranged it — tracked as a "value add" surfaced on their
// profiles). Every write goes through the withOrg-scoped updateEventDetails server
// action; this holds only whether the form is open. On save the server
// revalidates and the form closes.

type Option = { id: string; name: string };

export type EventDetails = {
  id: string;
  name: string;
  type: string;
  typeLabel: string;
  stage: string;
  date: string | null;
  dateLabel: string | null;
  venue: string | null;
  theme: string | null;
  capacity: number | null;
  description: string;
  projectId: string | null;
  projectName: string | null;
  venueCompanyId: string | null;
  venueCompanyName: string | null;
  venueContactId: string | null;
  venueContactName: string | null;
};

export function DetailsCard({
  event,
  projects,
  companies,
  contacts,
}: {
  event: EventDetails;
  projects: Option[];
  companies: Option[];
  contacts: Option[];
}) {
  const [editing, setEditing] = useState(false);

  const facts: Array<{ label: string; value: string | null }> = [
    { label: "Type", value: event.typeLabel },
    { label: "Date", value: event.dateLabel },
    { label: "Venue", value: event.venue },
    { label: "Theme", value: event.theme },
    {
      label: "Capacity",
      value: event.capacity == null ? null : String(event.capacity),
    },
    { label: "Project", value: event.projectName },
  ];

  const venueParts = [event.venueCompanyName, event.venueContactName].filter(
    (v): v is string => v != null,
  );
  const venueProvidedBy = venueParts.length > 0 ? venueParts.join(" · ") : null;

  return (
    <Card>
      <CardHeader
        title="Details"
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
      {editing ? (
        <form
          action={async (formData) => {
            await updateEventDetails(formData);
            setEditing(false);
          }}
          className="grid grid-cols-2 gap-4 p-4"
        >
          <input type="hidden" name="eventId" value={event.id} />
          <Field
            name="name"
            label="Event name"
            defaultValue={event.name}
            required
            className="col-span-2"
          />
          <SelectField name="type" label="Type" defaultValue={event.type}>
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </SelectField>
          <SelectField name="stage" label="Stage" defaultValue={event.stage}>
            {EVENT_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectField>
          <Field
            name="date"
            label="Date"
            type="date"
            defaultValue={event.date ?? ""}
          />
          <Field
            name="venue"
            label="Venue"
            defaultValue={event.venue ?? ""}
            placeholder="The Rhinecliff"
          />
          <Field
            name="capacity"
            label="Capacity"
            inputMode="numeric"
            defaultValue={event.capacity == null ? "" : String(event.capacity)}
            placeholder="0"
          />
          <Field
            name="theme"
            label="Theme"
            defaultValue={event.theme ?? ""}
            placeholder="Capital & construction"
          />
          <SelectField
            name="projectId"
            label="Linked project"
            defaultValue={event.projectId ?? ""}
          >
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="venueCompanyId"
            label="Venue company (value add)"
            defaultValue={event.venueCompanyId ?? ""}
          >
            <option value="">None</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            name="venueContactId"
            label="Venue provided by (contact)"
            defaultValue={event.venueContactId ?? ""}
          >
            <option value="">None</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <Field
            name="description"
            label="Description"
            defaultValue={event.description}
            placeholder="Short summary"
            className="col-span-2"
          />
          <div className="col-span-2 flex justify-end gap-3">
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save details
            </Button>
          </div>
        </form>
      ) : (
        <>
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
          {venueProvidedBy ? (
            <div className="border-t border-line px-4 py-3">
              <div className="text-[10px] tracking-[0.06em] text-ink-3 uppercase">
                Venue provided by
              </div>
              <div className="mt-1 text-xs text-ink">{venueProvidedBy}</div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
