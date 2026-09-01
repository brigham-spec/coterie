import { fieldLabel } from "@/components/ui";
import { PROJECT_TYPES } from "@/lib/project-types";

// Multi-select construction-type picker shared by the project add + edit forms.
// A project may combine several types, so each renders as a checkbox posting the
// same `type` name; the action reads them via formData.getAll("type"). Plain
// checkboxes (no client state) so this works inside both the server add form and
// the client edit form. `selected` pre-checks the project's current types.
export function ProjectTypeField({
  selected = [],
  className,
}: {
  selected?: string[];
  className?: string;
}) {
  const chosen = new Set(selected);
  return (
    <fieldset className={className}>
      <legend className={fieldLabel}>Type</legend>
      <div className="grid grid-cols-2 gap-1.5">
        {PROJECT_TYPES.map((t) => (
          <label key={t} className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              name="type"
              value={t}
              defaultChecked={chosen.has(t)}
              className="h-3.5 w-3.5 rounded-sm border-line-2 text-gold-line focus:ring-2 focus:ring-gold-line/20"
            />
            {t}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
