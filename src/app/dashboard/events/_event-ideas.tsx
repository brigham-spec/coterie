"use client";

import { useActionState } from "react";

import { Button, Card, CardHeader, TagBadge } from "@/components/ui";
import { getEventType } from "@/lib/event-stages";

import {
  saveEventIdea,
  suggestEvents,
  type EventIdeasState,
  type SaveIdeaState,
} from "./actions";
import type {
  EventIdea,
  IdeaExternalGuest,
  IdeaGuest,
} from "@/lib/event-ideas";

// Event-ideas panel (gap-audit cluster D) on the events page. A client shell over
// the suggestEvents server action, so the Anthropic key never crosses to the
// browser. Claude proposes distinct events grounded in the network's members,
// active projects, and recent meetings — each with a "why now", a tiered invite
// list, and an expected outcome. Results are ephemeral: re-run on demand; nothing
// is stored — but any idea the host likes can be saved as a real planning-stage
// event (its substance folded into the description), which drops into the table
// below while the other ideas stay on screen.

const initialState: EventIdeasState = { status: "idle" };
const saveInitialState: SaveIdeaState = { status: "idle" };

// Fold an idea's reasoning + curated guest list into a description string so none
// of the AI's work is lost when it becomes a real event (the event has one
// free-text description field; the host can trim it afterwards).
function composeDescription(idea: EventIdea): string {
  const lines: string[] = [];
  if (idea.theme) lines.push(idea.theme);
  if (idea.whyNow) lines.push(`Why now: ${idea.whyNow}`);
  if (idea.anchor) lines.push(`Anchor: ${idea.anchor}`);
  if (idea.expectedOutcome) lines.push(`Expected outcome: ${idea.expectedOutcome}`);
  const guests = [...idea.tier1, ...idea.tier2].map((g) => g.name);
  if (guests.length > 0) lines.push(`Suggested guests: ${guests.join(", ")}`);
  const external = idea.tier3External.map((g) => g.org);
  if (external.length > 0) lines.push(`External / prospects: ${external.join(", ")}`);
  if (idea.agenda.length > 0) lines.push(`Agenda: ${idea.agenda.join("; ")}`);
  return lines.join("\n");
}

export function EventIdeas() {
  const [state, formAction, isPending] = useActionState(
    suggestEvents,
    initialState,
  );

  return (
    <Card>
      <CardHeader title="Event ideas" />
      <div className="p-4">
        <p className="mb-3 text-[11px] text-ink-3">
          Suggest events grounded in what the network needs right now — members
          who&apos;ve never been brought together, active projects, and recent
          meeting activity. Each idea comes with a reason to hold it now and a
          tiered guest list.
        </p>
        <form action={formAction}>
          <Button type="submit" variant="gold" disabled={isPending}>
            {isPending ? "Thinking…" : "Suggest events"}
          </Button>
        </form>

        {isPending ? null : state.status === "error" ? (
          <p className="mt-3 text-[11px] text-red-ink">{state.message}</p>
        ) : state.status === "empty" ? (
          <p className="mt-3 text-[11px] text-ink-3 italic">
            Add member companies first — event ideas are built from the network.
          </p>
        ) : state.status === "ok" ? (
          state.ideas.length === 0 ? (
            <p className="mt-3 text-[11px] text-ink-3 italic">
              No ideas came back. Try again.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3">
              {state.ideas.map((idea, i) => (
                <IdeaCard key={i} idea={idea} />
              ))}
            </ul>
          )
        ) : null}
      </div>
    </Card>
  );
}

function IdeaCard({ idea }: { idea: EventIdea }) {
  const type = getEventType(idea.typeValue);
  return (
    <li className="rounded-md border border-line bg-surface-2 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{idea.title}</span>
        <TagBadge label={type.label} tone={type.tone} />
        <span className="text-[10px] text-ink-3">~{idea.idealSize} guests</span>
        <span className="ml-auto">
          <SaveIdeaButton idea={idea} />
        </span>
      </div>

      {idea.whyNow ? (
        <p className="mt-2 text-[11px] text-ink-2">
          <span className="font-semibold text-ink">Why now: </span>
          {idea.whyNow}
        </p>
      ) : null}
      {idea.theme ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">{idea.theme}</p>
      ) : null}

      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10.5px]">
        <Detail label="Timing" value={idea.suggestedTiming} />
        <Detail label="Venue" value={idea.suggestedVenue} />
        <Detail label="Anchor" value={idea.anchor} />
        <Detail label="Outcome" value={idea.expectedOutcome} />
      </dl>

      {idea.tier1.length > 0 ? (
        <GuestTier label="Essential" guests={idea.tier1} />
      ) : null}
      {idea.tier2.length > 0 ? (
        <GuestTier label="Strong additions" guests={idea.tier2} />
      ) : null}
      {idea.tier3External.length > 0 ? (
        <ExternalTier guests={idea.tier3External} />
      ) : null}

      {idea.agenda.length > 0 ? (
        <div className="mt-2.5">
          <div className="text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
            Agenda
          </div>
          <ol className="mt-1 list-decimal pl-4 text-[10.5px] text-ink-2 marker:text-ink-3">
            {idea.agenda.map((item, i) => (
              <li key={i} className="leading-relaxed">
                {item}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
}

// Save one idea as a real planning-stage event. The idea's fields ride along as
// hidden inputs (type is validated server-side against the canonical vocabulary);
// on success the button latches to "Added" and the new event appears in the table
// below via the action's revalidate.
function SaveIdeaButton({ idea }: { idea: EventIdea }) {
  const [state, formAction, isPending] = useActionState(
    saveEventIdea,
    saveInitialState,
  );

  if (state.status === "saved") {
    return <span className="text-[10.5px] text-ink-3">Added to calendar</span>;
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="name" value={idea.title} />
      <input type="hidden" name="type" value={idea.typeValue} />
      <input type="hidden" name="venue" value={idea.suggestedVenue} />
      <input type="hidden" name="capacity" value={String(idea.idealSize)} />
      <input type="hidden" name="description" value={composeDescription(idea)} />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save as event"}
      </Button>
      {state.status === "error" ? (
        <span className="ml-2 text-[10.5px] text-red-ink">{state.message}</span>
      ) : null}
    </form>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="inline font-semibold text-ink-3">{label}: </dt>
      <dd className="inline text-ink-2">{value}</dd>
    </div>
  );
}

function GuestTier({
  label,
  guests,
}: {
  label: string;
  guests: IdeaGuest[];
}) {
  return (
    <div className="mt-2.5">
      <div className="text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
        {label}
      </div>
      <ul className="mt-1 flex flex-col gap-0.5 text-[10.5px] text-ink-2">
        {guests.map((g) => (
          <li key={g.companyId}>
            <span className="font-medium text-ink">{g.name}</span>
            {g.why ? <span className="text-ink-3"> — {g.why}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExternalTier({ guests }: { guests: IdeaExternalGuest[] }) {
  return (
    <div className="mt-2.5">
      <div className="text-[10px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
        External / prospects
      </div>
      <ul className="mt-1 flex flex-col gap-0.5 text-[10.5px] text-ink-2">
        {guests.map((g, i) => (
          <li key={i}>
            <span className="font-medium text-ink">{g.org}</span>
            {g.isProspect ? (
              <span className="text-gold-ink"> · prospect</span>
            ) : null}
            {g.why ? <span className="text-ink-3"> — {g.why}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
