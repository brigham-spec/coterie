"use client";

import { useState } from "react";

import { Button, Card, CardHeader, TagBadge } from "@/components/ui";
import {
  ASSISTANCE_DEFS,
  getAssistanceDef,
  type AssistanceKey,
} from "@/lib/project-assistance";

import { updateProjectAssistance } from "../actions";

// Assistance-requested card — what the project is asking the org to help with
// (equity sourcing, CFA, IDA navigation, grants, entitlements, …). An intake
// signal distinct from the HVEDC Services card, which tracks delivered lines and
// their fees. The whole selection is written at once by updateProjectAssistance;
// this holds only local UI state (edit open).

export function AssistanceCard({
  projectId,
  selected,
}: {
  projectId: string;
  selected: AssistanceKey[];
}) {
  const [editing, setEditing] = useState(false);
  const selectedSet = new Set<string>(selected);

  return (
    <Card>
      <CardHeader
        title="Assistance requested"
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

      <p className="border-b border-line px-4 py-2 text-[10.5px] text-ink-3">
        What this project is looking to the org for help with.
      </p>

      {editing ? (
        <form
          action={async (fd) => {
            await updateProjectAssistance(fd);
            setEditing(false);
          }}
          className="flex flex-col gap-3 border-b border-line p-4"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ASSISTANCE_DEFS.map((d) => (
              <label
                key={d.key}
                className="flex items-start gap-2 rounded-md border border-line p-2.5 text-xs text-ink"
              >
                <input
                  type="checkbox"
                  name="assistance"
                  value={d.key}
                  defaultChecked={selectedSet.has(d.key)}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <span className="min-w-0">
                  <span className="font-medium">{d.label}</span>
                  <span className="mt-0.5 block text-[10px] text-ink-3">
                    {d.desc}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      ) : selected.length === 0 ? (
        <p className="px-4 py-6 text-xs text-ink-3">
          No assistance requested tracked yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-4 py-4">
          {selected.map((key) => (
            <TagBadge key={key} tone="teal" label={getAssistanceDef(key).label} />
          ))}
        </div>
      )}
    </Card>
  );
}
