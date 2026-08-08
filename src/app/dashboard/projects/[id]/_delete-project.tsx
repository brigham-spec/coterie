"use client";

import { useState } from "react";

import { Button, Card, CardHeader } from "@/components/ui";

import { deleteProject } from "../actions";

// Two-step-confirm project delete (mirrors the company DangerZone). The server
// action removes the project — child links, team members, funding sources, and
// deliverables cascade at the DB — then redirects to the directory.
export function DeleteProject({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <CardHeader title="Danger zone" />
      <div className="px-4 py-3">
        {confirming ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-ink-2">
              Permanently delete{" "}
              <span className="font-medium">{projectName}</span> and all of its
              participants, team, funding, and deliverables? This cannot be
              undone.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <form action={deleteProject}>
                <input type="hidden" name="projectId" value={projectId} />
                <Button type="submit" variant="danger">
                  Delete permanently
                </Button>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[10px] font-medium tracking-[0.06em] text-red uppercase hover:underline"
            >
              Delete project
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
