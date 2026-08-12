"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Card, CardHeader } from "@/components/ui";

import {
  attachConnection,
  dismissConnection,
} from "../../new-connections-actions";

// Second-Degree Contacts (Members item 10) — the profile-scoped port of the
// prototype's "+ Add to network" chips. Lists the Fireflies attendees who appeared
// in one of this company's meetings but match no network contact (the loader
// intersects each unmatched row's meetingIds with this company's meetings). "Add to
// network"
// attaches the person as a contact on THIS company; the × dismisses them for good.
// Both reuse the dashboard's New Connections actions, keyed by unmatched-row id.
// After either effect we refresh the route so the handled chip drops out and a
// newly-added contact appears in the roster above.

export type SecondDegreePerson = {
  id: string;
  name: string;
  email: string;
  seenCount: number;
  lastMeetingTitle: string | null;
};

export function SecondDegreeCard({
  companyId,
  people,
}: {
  companyId: string;
  people: SecondDegreePerson[];
}) {
  if (people.length === 0) return null;

  return (
    <Card>
      <CardHeader title="People from meetings" />
      <p className="px-4 pt-3 text-[10.5px] leading-relaxed text-ink-3">
        Seen in this company&apos;s meetings via Fireflies but not yet in your
        network.
      </p>
      <ul className="flex flex-wrap gap-2 p-4">
        {people.map((p) => (
          <PersonChip key={p.id} companyId={companyId} person={p} />
        ))}
      </ul>
    </Card>
  );
}

function PersonChip({
  companyId,
  person,
}: {
  companyId: string;
  person: SecondDegreePerson;
}) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ status: string; message?: string }>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.status === "error") {
        setError(result.message ?? "Something went wrong.");
        return;
      }
      // Success deletes/dismisses the unmatched row; refresh drops this chip and
      // surfaces the new contact in the roster above.
      router.refresh();
    });
  }

  const subtitle =
    person.seenCount > 1
      ? `${person.seenCount}\u00d7 · ${person.email}`
      : person.email;

  return (
    <li className="flex flex-col rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11.5px] font-medium text-ink">
            {person.name}
          </div>
          <div className="truncate text-[9.5px] text-ink-3">{subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => attachConnection(person.id, companyId))}
            className="rounded-sm border border-gold-line bg-gold-bg px-2 py-0.5 text-[10px] font-medium text-gold-ink transition-colors hover:bg-gold-bg/70 disabled:opacity-50"
          >
            Add to network
          </button>
          <button
            type="button"
            disabled={isPending}
            title="Dismiss this person"
            onClick={() => run(() => dismissConnection(person.id))}
            className="px-1 text-[12px] leading-none text-ink-3 hover:text-ink disabled:opacity-50"
          >
            {"\u2715"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 text-[10px] text-red-ink">{error}</p> : null}
    </li>
  );
}
