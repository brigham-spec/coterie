"use client";

import { useActionState } from "react";

import { AddDisclosure, Button, Field, SelectField } from "@/components/ui";

import { updateProjectDetails, type UpdateDetailsState } from "../actions";

// Edit-details form for a project's core profile facts. Split into a client
// component so the "Save details" submit can surface an inline "Saved"
// confirmation (and validation errors) via useActionState — the user no longer
// has to scroll back up the page to confirm the write landed.

export type EditDetailsProject = {
  id: string;
  name: string;
  description: string;
  type: string | null;
  industry: string | null;
  county: string | null;
  units: number | null;
  sqft: number | null;
  value: string | null;
  realizedValue: string | null;
  targetDate: string | null; // yyyy-mm-dd
  prospectLead: string | null;
};

export type CompanyOption = { id: string; name: string };

const initialState: UpdateDetailsState = { status: "idle" };

export function EditDetails({
  project,
  developerId,
  companies,
}: {
  project: EditDetailsProject;
  developerId: string;
  companies: CompanyOption[];
}) {
  const [state, formAction, isPending] = useActionState(
    updateProjectDetails,
    initialState,
  );

  return (
    <AddDisclosure label="Edit details" className="border-t border-line">
      <form
        action={formAction}
        className="grid grid-cols-2 gap-4 border-t border-line p-4"
      >
        <input type="hidden" name="projectId" value={project.id} />
        <Field
          name="name"
          label="Name"
          defaultValue={project.name}
          required
          className="col-span-2"
        />
        <Field
          name="description"
          label="Description"
          defaultValue={project.description}
          placeholder="Short summary"
          className="col-span-2"
        />
        <Field
          name="type"
          label="Type"
          defaultValue={project.type ?? ""}
          placeholder="Mixed-use"
        />
        <Field
          name="industry"
          label="Industry"
          defaultValue={project.industry ?? ""}
          placeholder="Hospitality"
        />
        <Field
          name="county"
          label="County"
          defaultValue={project.county ?? ""}
          placeholder="Dutchess"
        />
        <Field
          name="units"
          label="Units / keys"
          inputMode="numeric"
          defaultValue={project.units == null ? "" : String(project.units)}
          placeholder="0"
        />
        <Field
          name="sqft"
          label="Sq ft"
          inputMode="numeric"
          defaultValue={project.sqft == null ? "" : String(project.sqft)}
          placeholder="0"
        />
        <Field
          name="value"
          label="Value (USD)"
          inputMode="numeric"
          defaultValue={project.value == null ? "" : String(project.value)}
          placeholder="0"
        />
        <Field
          name="realizedValue"
          label="Realized value (USD)"
          inputMode="numeric"
          defaultValue={
            project.realizedValue == null ? "" : String(project.realizedValue)
          }
          placeholder="0"
        />
        <Field
          name="targetDate"
          label="Target date"
          type="date"
          defaultValue={project.targetDate ?? ""}
        />
        <SelectField
          name="developerMemberId"
          label="Developer (member)"
          defaultValue={developerId}
        >
          <option value="">None</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <Field
          name="prospectLead"
          label="Developer / lead (off-network)"
          defaultValue={project.prospectLead ?? ""}
          placeholder="Lead org or developer"
          className="col-span-2"
        />
        <div className="col-span-2 flex items-center justify-end gap-3">
          {state.status === "saved" ? (
            <span className="text-xs text-teal-ink">Saved.</span>
          ) : null}
          {state.status === "error" ? (
            <span className="text-xs text-red-ink">{state.message}</span>
          ) : null}
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
    </AddDisclosure>
  );
}
