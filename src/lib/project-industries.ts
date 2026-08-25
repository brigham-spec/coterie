// Suggested project "industry" / asset-class values for the project add + edit
// forms. Rendered as a native <datalist> so these surface as a dropdown of the
// applicable development types while still allowing a free-text entry for any
// asset class not listed here — existing free-text project industries stay valid
// and the store keeps whatever the user types.
export const PROJECT_INDUSTRIES = [
  "Master Development",
  "Mixed Use Multifamily",
  "Multifamily",
  "LIHTC",
  "Affordable Housing",
  "Senior Living",
  "Student Housing",
  "Hospitality",
  "Retail",
  "Office",
  "Industrial",
  "Life Sciences",
  "Healthcare",
  "Data Center",
  "Self Storage",
  "Land / Entitlement",
] as const;
