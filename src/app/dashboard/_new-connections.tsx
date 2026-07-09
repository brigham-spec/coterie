"use client";

import { useMemo, useState, useTransition } from "react";

import { cn } from "@/components/ui";

import {
  promoteConnection,
  attachConnection,
  dismissConnection,
  dismissConnectionDomain,
  type ConnectionActionResult,
} from "./new-connections-actions";
import type { ConnectionGroup, ConnectionRow } from "@/lib/new-connections";

// New Connections Detected (dashboard panel) — the prototype's "New Connections
// Detected". People who showed up in Fireflies meetings but match no contact,
// grouped by their email domain (inferred organisation). Each can be promoted to
// a prospect, attached to an existing company, or dismissed. All effects run
// through server actions that revalidate /dashboard, so a handled row simply drops
// out of the next render — no local list bookkeeping. Rendered always (with an
// empty state) so the surface stays discoverable.

type CompanyLite = { id: string; name: string };

export function NewConnections({
  groups,
  companies,
}: {
  groups: ConnectionGroup[];
  companies: CompanyLite[];
}) {
  const [open, setOpen] = useState(true);
  const totalPeople = groups.reduce((sum, g) => sum + g.people.length, 0);

  return (
    <div className="mb-4 overflow-hidden rounded-md border border-line bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5 text-left"
      >
        <span className="flex-1 text-[10px] font-medium tracking-[0.07em] text-ink-3 uppercase">
          New Connections Detected
        </span>
        {totalPeople > 0 ? (
          <span className="rounded-full border border-gold-line bg-gold-bg px-2 py-0.5 text-[10px] font-medium text-gold-ink">
            {totalPeople} {totalPeople === 1 ? "person" : "people"} ·{" "}
            {groups.length} {groups.length === 1 ? "org" : "orgs"}
          </span>
        ) : null}
        <span className="text-[11px] text-ink-3">{open ? "\u25b4" : "\u25be"}</span>
      </button>

      {open ? (
        totalPeople === 0 ? (
          <p className="px-4 py-5 text-[11px] text-ink-3 italic">
            No new people to review. Meeting attendees who aren&apos;t in your CRM
            yet will appear here after a Fireflies sync.
          </p>
        ) : (
          <div>
            {groups.map((group) => (
              <GroupBlock
                key={group.domain}
                group={group}
                companies={companies}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function GroupBlock({
  group,
  companies,
}: {
  group: ConnectionGroup;
  companies: CompanyLite[];
}) {
  const [isPending, start] = useTransition();

  return (
    <div className="border-b border-line px-4 py-2.5 last:border-b-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[11.5px] font-semibold text-ink">
          {group.orgName}
        </span>
        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[9px] text-ink-3">
          {group.domain}
        </span>
        {group.people.length > 1 ? (
          <span className="text-[9.5px] text-ink-3">
            {group.people.length} people
          </span>
        ) : null}
        <span className="flex-1" />
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            start(async () => {
              await dismissConnectionDomain(group.domain);
            })
          }
          className="text-[9.5px] text-ink-3 hover:text-ink disabled:opacity-50"
        >
          Dismiss org
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {group.people.map((person) => (
          <PersonRow key={person.id} person={person} companies={companies} />
        ))}
      </ul>
    </div>
  );
}

function PersonRow({
  person,
  companies,
}: {
  person: ConnectionRow;
  companies: CompanyLite[];
}) {
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  function run(fn: () => Promise<ConnectionActionResult>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.status === "error") setError(result.message);
      // On success the action revalidates /dashboard and this row unmounts.
    });
  }

  const name = person.inferredName?.trim() || person.email;

  return (
    <li className="rounded-sm bg-surface-2 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[11.5px] font-medium text-ink">
            {name}
          </div>
          <div className="truncate text-[10px] text-ink-3">{person.email}</div>
          {person.lastMeetingTitle ? (
            <div className="mt-0.5 truncate text-[9.5px] text-ink-3">
              {person.seenCount > 1 ? `${person.seenCount}\u00d7 · ` : ""}
              {person.lastMeetingTitle}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ActionButton
            variant="gold"
            disabled={isPending}
            onClick={() => run(() => promoteConnection(person.id))}
          >
            Prospect
          </ActionButton>
          <ActionButton
            disabled={isPending}
            onClick={() => setAttachOpen((o) => !o)}
          >
            Attach
          </ActionButton>
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

      {attachOpen ? (
        <CompanyPicker
          companies={companies}
          disabled={isPending}
          onPick={(companyId) =>
            run(async () => {
              const r = await attachConnection(person.id, companyId);
              if (r.status !== "error") setAttachOpen(false);
              return r;
            })
          }
        />
      ) : null}

      {error ? (
        <p className="mt-1 text-[10px] text-red-600">{error}</p>
      ) : null}
    </li>
  );
}

function CompanyPicker({
  companies,
  disabled,
  onPick,
}: {
  companies: CompanyLite[];
  disabled: boolean;
  onPick: (companyId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return companies
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, companies]);

  return (
    <div className="mt-2">
      <input
        type="text"
        autoFocus
        disabled={disabled}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a company to attach to…"
        className="w-full rounded-sm border border-line-2 bg-surface px-2.5 py-1 text-[11px] text-ink outline-none focus:border-gold-line"
      />
      {matches.length > 0 ? (
        <ul className="mt-1 overflow-hidden rounded-sm border border-line">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(c.id)}
                className="block w-full border-b border-line px-2.5 py-1.5 text-left text-[11px] text-ink-2 last:border-b-0 hover:bg-surface-2 disabled:opacity-50"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 ? (
        <p className="mt-1 text-[10px] text-ink-3 italic">No match.</p>
      ) : null}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "gold";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-sm border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50",
        variant === "gold"
          ? "border-gold-line bg-gold-bg text-gold-ink hover:bg-gold-bg/70"
          : "border-line bg-surface text-ink-2 hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}
