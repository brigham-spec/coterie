"use client";

import { useState } from "react";

import { Button, Card, CardHeader, Field } from "@/components/ui";
import { TEAM_ROLE_DEFS, teamRoleLabel } from "@/lib/team-roles";

import { addTeamMember, updateTeamMember, removeTeamMember } from "../actions";

// Professional Team roster (projects-module parity; ported from the prototype's
// Professional Team section, Coterie.html:17662). Each member is an INDIVIDUAL
// professional — architect, land-use attorney, lender, GC, etc. — captured as
// free text so off-network people can be tracked, with an optional link to a CRM
// company. Writes go through the withOrg-scoped project actions; this holds only
// local UI state (whether a form is open / which row is being edited).

export type TeamMemberRow = {
  id: string;
  role: string;
  name: string;
  org: string;
  email: string;
  companyId: string | null;
  companyName: string | null;
};

export type TeamCompanyOption = { id: string; name: string };

export function TeamCard({
  projectId,
  members,
  companies,
}: {
  projectId: string;
  members: TeamMemberRow[];
  companies: TeamCompanyOption[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Professional team"
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
          <TeamForm
            projectId={projectId}
            companies={companies}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      {members.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No team members yet. Use “Add” to build the project’s professional team.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <TeamItem
              key={m.id}
              projectId={projectId}
              member={m}
              companies={companies}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function TeamItem({
  projectId,
  member,
  companies,
}: {
  projectId: string;
  member: TeamMemberRow;
  companies: TeamCompanyOption[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="p-4">
        <TeamForm
          projectId={projectId}
          companies={companies}
          member={member}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink">
            {member.name || member.org || "—"}
          </span>
          <span className="rounded-sm border border-line-2 bg-surface px-1.5 py-0.5 text-[10px] text-ink-2">
            {teamRoleLabel(member.role)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          {member.name && member.org ? <span>{member.org}</span> : null}
          {member.companyName ? (
            <span className="rounded-full bg-gold-bg px-1.5 py-0.5 text-[9px] text-gold-ink">
              {member.companyName}
            </span>
          ) : null}
          {member.email ? (
            <a href={`mailto:${member.email}`} className="hover:text-gold">
              {member.email}
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
        <form action={removeTeamMember}>
          <input type="hidden" name="memberId" value={member.id} />
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

function TeamForm({
  projectId,
  companies,
  member,
  onDone,
}: {
  projectId: string;
  companies: TeamCompanyOption[];
  member?: TeamMemberRow;
  onDone: () => void;
}) {
  const action = member ? updateTeamMember : addTeamMember;

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="projectId" value={projectId} />
      {member ? <input type="hidden" name="memberId" value={member.id} /> : null}

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
            Role
          </span>
          <select
            name="role"
            defaultValue={member?.role ?? ""}
            required
            className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink"
          >
            <option value="" disabled>
              Select a role…
            </option>
            {TEAM_ROLE_DEFS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <Field
          name="name"
          label="Name"
          placeholder="Jane Doe"
          defaultValue={member?.name}
        />
        <Field
          name="org"
          label="Organization"
          placeholder="Firm or company"
          defaultValue={member?.org}
        />
        <Field
          name="email"
          label="Email"
          type="email"
          placeholder="jane@firm.com"
          defaultValue={member?.email}
        />
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] font-medium tracking-[0.06em] text-ink-2 uppercase">
          Link a CRM company (optional)
        </span>
        <select
          name="companyId"
          defaultValue={member?.companyId ?? ""}
          className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink"
        >
          <option value="">Not linked</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {member ? "Save" : "Add member"}
        </Button>
      </div>
    </form>
  );
}
