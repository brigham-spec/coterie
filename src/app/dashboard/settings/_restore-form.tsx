"use client";

import { useState, type FormEvent } from "react";

import { Button, Field, SelectField } from "@/components/ui";

// Platform-operator restore control. Reads a backup JSON file in the browser and
// POSTs it to settings/import for the chosen target org. This surface only
// renders for the operator (settings/page.tsx gates on isPlatformAdmin), and the
// route re-checks that gate before writing. The restore refuses a non-empty
// target, so the operator picks a freshly-created, empty org.

type OrgOption = { id: string; name: string };

export function RestoreForm({ orgs }: { orgs: readonly OrgOption[] }) {
  const [targetOrgId, setTargetOrgId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(null);
    if (!targetOrgId) return setError("Choose a target organization.");
    if (!file) return setError("Choose an export file.");

    setBusy(true);
    try {
      const text = await file.text();
      const res = await fetch(
        `/dashboard/settings/import?targetOrgId=${encodeURIComponent(targetOrgId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: text,
        },
      );
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data &&
          typeof data === "object" &&
          typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Restore failed (${res.status}).`;
        setError(message);
        return;
      }
      const total =
        data && typeof data === "object"
          ? (data as { total?: unknown }).total
          : undefined;
      setDone(
        typeof total === "number"
          ? `Restored ${total} rows into the target org.`
          : "Restore complete.",
      );
      setFile(null);
    } catch {
      setError("Could not read or upload the file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <SelectField
        label="Target organization"
        value={targetOrgId}
        onChange={(e) => setTargetOrgId(e.target.value)}
      >
        <option value="">Select an organization…</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </SelectField>

      <Field
        label="Export file"
        type="file"
        accept="application/json,.json"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <div className="flex items-center justify-between">
        <span className="text-[11px]">
          {error ? (
            <span className="text-red-ink">{error}</span>
          ) : done ? (
            <span className="text-ink-2">{done}</span>
          ) : null}
        </span>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Restoring…" : "Restore into org"}
        </Button>
      </div>
    </form>
  );
}
