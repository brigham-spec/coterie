/// PURE: a filesystem-safe slug for a download filename — lowercase, each run of
/// non-alphanumerics collapsed to a single dash, trimmed, with an "org" fallback
/// for an all-punctuation name. Shared by the data-export routes so a backup/CSV
/// filename is derived the same way everywhere.
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}
