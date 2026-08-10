"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui";
import { OPTIONAL_MODULES } from "@/lib/modules";

import { setOrgModules, type SetModulesState } from "./actions";

// Platform-operator editor for which OPTIONAL modules this org sees. One checkbox
// per optional module; checked keys are submitted as "module" and stored as the
// enabled list (core modules are always on and never appear here). This surface
// only renders for the platform operator (settings/page.tsx gates on
// isPlatformAdmin), and the server action re-checks that gate before writing.

const initial: SetModulesState = { status: "idle" };

export function ModulesForm({ enabled }: { enabled: string[] }) {
  const [state, action, saving] = useActionState(setOrgModules, initial);
  const on = new Set(enabled);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        {OPTIONAL_MODULES.map((m) => (
          <label
            key={m.key}
            className="flex items-center gap-2.5 text-xs text-ink"
          >
            <input
              type="checkbox"
              name="module"
              value={m.key}
              defaultChecked={on.has(m.key)}
              className="h-3.5 w-3.5 accent-gold"
            />
            <span>{m.label}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px]">
          {state.status === "saved" ? (
            <span className="text-ink-2">
              Saved {state.count} module{state.count === 1 ? "" : "s"}.
            </span>
          ) : state.status === "error" ? (
            <span className="text-red-ink">{state.message}</span>
          ) : null}
        </span>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save modules"}
        </Button>
      </div>
    </form>
  );
}
