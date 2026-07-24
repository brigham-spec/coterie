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
import { INTRO_STAGES, getIntroStageDef } from "@/lib/intro-stages";

import {
  addEventActionItem,
  deleteEventActionItem,
  logIntroductionAtEvent,
  updateEventActionItemStatus,
  updateEventNotes,
} from "../actions";

// Post-event debrief (S2 events part B, ported from the prototype's event recap).
// Three surfaces the host fills in after the room clears: a free-text recap
// (event.notes), the follow-up commitments that came out of it (action_items
// anchored to the event), and the introductions made in the room (first-class
// Introductions anchored to the event). Follow-ups and intros also surface on
// their global workspaces; the actions revalidate both. This card only holds
// local UI state (the direction chosen so the owner picker offers the right
// people); every write goes through the withOrg-scoped event actions.

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export type FollowUp = {
  id: string;
  text: string;
  status: string;
  dueDate: Date | null;
  ownerName: string | null;
  direction: "we_owe" | "they_owe";
};

export type EventIntro = {
  id: string;
  partyAName: string;
  partyBName: string;
  status: string;
  madeOn: Date | null;
};

type Person = { id: string; name: string };

export function Debrief({
  eventId,
  notes,
  followUps,
  intros,
  staff,
  guests,
}: {
  eventId: string;
  notes: string;
  followUps: FollowUp[];
  intros: EventIntro[];
  staff: Person[];
  guests: Person[];
}) {
  return (
    <>
      <NotesCard eventId={eventId} notes={notes} />
      <FollowUpsCard
        eventId={eventId}
        followUps={followUps}
        staff={staff}
        guests={guests}
      />
      <IntrosCard eventId={eventId} intros={intros} guests={guests} />
    </>
  );
}

function NotesCard({ eventId, notes }: { eventId: string; notes: string }) {
  return (
    <Card>
      <CardHeader title="Debrief notes" />
      <form action={updateEventNotes} className="p-4">
        <input type="hidden" name="eventId" value={eventId} />
        <Textarea
          name="notes"
          label="What happened, who connected, what to follow up on"
          defaultValue={notes}
          rows={4}
        />
        <div className="mt-3 flex justify-end">
          <Button type="submit" variant="primary">
            Save notes
          </Button>
        </div>
      </form>
    </Card>
  );
}

function FollowUpsCard({
  eventId,
  followUps,
  staff,
  guests,
}: {
  eventId: string;
  followUps: FollowUp[];
  staff: Person[];
  guests: Person[];
}) {
  const [adding, setAdding] = useState(false);
  const open = followUps.filter((f) => f.status === "open");
  const closed = followUps.filter((f) => f.status !== "open");

  return (
    <Card>
      <CardHeader
        title={`Follow-ups (${open.length})`}
        action={
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            {adding ? "Close" : "Add follow-up"}
          </button>
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <FollowUpForm
            eventId={eventId}
            staff={staff}
            guests={guests}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {open.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No open follow-ups from this event yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3 p-4">
          {open.map((f) => (
            <FollowUpItem key={f.id} eventId={eventId} item={f} />
          ))}
        </ul>
      )}

      {closed.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
            Resolved
          </div>
          <ul className="flex flex-col gap-1.5">
            {closed.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 text-[11px] text-ink-3"
              >
                <span className={f.status === "done" ? "line-through" : ""}>
                  {f.text}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="uppercase">{f.status}</span>
                  <form action={updateEventActionItemStatus}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="status" value="open" />
                    <button
                      type="submit"
                      className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
                    >
                      Reopen
                    </button>
                  </form>
                  <form action={deleteEventActionItem}>
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <button
                      type="submit"
                      className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function FollowUpItem({
  eventId,
  item,
}: {
  eventId: string;
  item: FollowUp;
}) {
  return (
    <li className="text-xs text-ink-2">
      <div>{item.text}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-3">
        <span>{item.direction === "we_owe" ? "We owe" : "They owe"}</span>
        {item.ownerName ? <span>· {item.ownerName}</span> : null}
        {item.dueDate ? <span>· due {dateFmt.format(item.dueDate)}</span> : null}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <form action={updateEventActionItemStatus}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="status" value="done" />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            Done
          </button>
        </form>
        <form action={updateEventActionItemStatus}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="status" value="dropped" />
          <button
            type="submit"
            className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase hover:underline"
          >
            Drop
          </button>
        </form>
        <form action={deleteEventActionItem}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="eventId" value={eventId} />
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

function FollowUpForm({
  eventId,
  staff,
  guests,
  onDone,
}: {
  eventId: string;
  staff: Person[];
  guests: Person[];
  onDone: () => void;
}) {
  // Track direction so the owner picker offers the right people: staff for a
  // "we owe" item, this event's guests for a "they owe" item.
  const [direction, setDirection] = useState<"we_owe" | "they_owe">("we_owe");
  const owners = direction === "we_owe" ? staff : guests;

  return (
    <form
      action={async (fd) => {
        await addEventActionItem(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="eventId" value={eventId} />

      <Textarea name="text" label="Follow-up" required />

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          name="direction"
          label="Direction"
          value={direction}
          onChange={(e) =>
            setDirection(e.currentTarget.value as "we_owe" | "they_owe")
          }
        >
          <option value="we_owe">We owe them</option>
          <option value="they_owe">They owe us</option>
        </SelectField>
        <SelectField
          name="ownerId"
          label="Owner"
          // Remount on direction change so the default selection resets.
          key={direction}
          defaultValue=""
          required
        >
          <option value="">Select…</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectField>
        <Field name="dueDate" label="Due date" type="date" />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Add follow-up
        </Button>
      </div>
    </form>
  );
}

function IntrosCard({
  eventId,
  intros,
  guests,
}: {
  eventId: string;
  intros: EventIntro[];
  guests: Person[];
}) {
  const [adding, setAdding] = useState(false);
  // Need at least two guests to introduce.
  const canAdd = guests.length >= 2;

  return (
    <Card>
      <CardHeader
        title={`Introductions made (${intros.length})`}
        action={
          canAdd ? (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
            >
              {adding ? "Close" : "Log introduction"}
            </button>
          ) : undefined
        }
      />

      {adding ? (
        <div className="border-b border-line p-4">
          <IntroForm
            eventId={eventId}
            guests={guests}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {intros.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          {canAdd
            ? "No introductions logged from this event yet."
            : "Invite at least two network guests to log an introduction."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {intros.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
            >
              <div>
                <span className="text-ink">
                  {i.partyAName} ↔ {i.partyBName}
                </span>
                {i.madeOn ? (
                  <span className="ml-2 text-[10px] text-ink-3">
                    {dateFmt.format(i.madeOn)}
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase">
                {getIntroStageDef(i.status).label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function IntroForm({
  eventId,
  guests,
  onDone,
}: {
  eventId: string;
  guests: Person[];
  onDone: () => void;
}) {
  return (
    <form
      action={async (fd) => {
        await logIntroductionAtEvent(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="eventId" value={eventId} />

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          name="partyAContactId"
          label="First guest"
          defaultValue=""
          required
        >
          <option value="">Select…</option>
          {guests.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          name="partyBContactId"
          label="Second guest"
          defaultValue=""
          required
        >
          <option value="">Select…</option>
          {guests.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </SelectField>
        <SelectField name="status" label="Stage" defaultValue="made">
          {INTRO_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <Field name="madeOn" label="Made on" type="date" />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Log introduction
        </Button>
      </div>
    </form>
  );
}
