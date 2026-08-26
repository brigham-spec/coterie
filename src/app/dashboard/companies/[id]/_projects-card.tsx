"use client";

import Link from "next/link";
import { useState } from "react";

import { Button, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  PROJECT_LINK_ROLE_GROUPS,
  projectLinkRoleLabel,
} from "@/lib/project-roles";

import { addParticipant, removeParticipant } from "../../projects/actions";

// Projects this company participates in (project_links). Read-only display plus
// an "Add" disclosure to link the company to any org project it isn't already on
// — the company-side mirror of the project page's participant form. Both post the
// same addParticipant/removeParticipant actions, which revalidate this path. A
// company may now hold several roles on one project, so each row keys on the
// participant's own id and removes by that id.

export type LinkedProject = {
  linkId: string;
  projectId: string;
  projectName: string;
  projectStage: string;
  role: string;
};

export type ProjectOption = { id: string; name: string };

export function ProjectsCard({
  companyId,
  links,
  linkable,
}: {
  companyId: string;
  links: LinkedProject[];
  linkable: ProjectOption[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <CollapsibleCard
      id="company-projects"
      title="Projects"
      action={
        linkable.length > 0 ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-[10px] font-medium tracking-[0.06em] text-gold uppercase hover:underline"
          >
            {adding ? "Close" : "Link project"}
          </button>
        ) : null
      }
    >
      {adding ? (
        <div className="border-b border-line p-4">
          <form
            action={addParticipant}
            className="grid grid-cols-[1fr_auto_auto] items-end gap-3"
          >
            <input type="hidden" name="companyId" value={companyId} />
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase">
                Project
              </span>
              <select
                name="projectId"
                defaultValue=""
                required
                className="rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
              >
                <option value="" disabled>
                  Select a project…
                </option>
                {linkable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium tracking-[0.06em] text-ink-3 uppercase">
                Role
              </span>
              <select
                name="role"
                defaultValue=""
                required
                className="rounded-sm border border-line-2 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-gold-line"
              >
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
              </select>
            </label>
            <Button type="submit" variant="gold">
              Link
            </Button>
          </form>
        </div>
      ) : null}

      {links.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          Not linked to any projects yet.
        </p>
      ) : (
        <Table
          head={
            <>
              <Th>Project</Th>
              <Th>Role</Th>
              <Th>Stage</Th>
              <Th> </Th>
            </>
          }
        >
          {links.map((l) => (
            <Tr key={l.linkId}>
              <Td className="font-medium">
                <Link
                  href={`/dashboard/projects/${l.projectId}`}
                  className="hover:text-gold hover:underline"
                >
                  {l.projectName}
                </Link>
              </Td>
              <Td>{projectLinkRoleLabel(l.role)}</Td>
              <Td>
                <StatusBadge status={l.projectStage} />
              </Td>
              <Td className="text-right">
                <form action={removeParticipant}>
                  <input type="hidden" name="linkId" value={l.linkId} />
                  <input type="hidden" name="projectId" value={l.projectId} />
                  <button
                    type="submit"
                    className="text-[10px] text-ink-3 hover:text-red-ink"
                  >
                    Unlink
                  </button>
                </form>
              </Td>
            </Tr>
          ))}
        </Table>
      )}
    </CollapsibleCard>
  );
}
