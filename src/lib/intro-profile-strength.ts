// Profile-strength heuristic for the introduction engine (S6c, item 19 — ports
// the prototype's "Profile Sparse/Fair" bar at Coterie.html:14782). A richer focus
// profile gives the model more to reason over, so before a member scan we surface
// how complete the focus company is and which signals are still missing. PURE — no
// DB, no secrets; the caller derives the booleans from the company row.
//
// The prototype weighted meeting history too; production's engine profile does not
// carry a meeting count, so the weight is redistributed across the signals the
// engine actually reads (needs, offers, active work, industry, a primary contact).

export interface ProfileStrengthSignals {
  canOffer: boolean;
  lookingFor: boolean;
  hasProjects: boolean;
  hasIndustry: boolean;
  hasPrimaryContact: boolean;
}

export type ProfileStrengthLabel = "Sparse" | "Fair" | "Strong";

export interface ProfileStrength {
  score: number; // 0..100
  label: ProfileStrengthLabel;
  missing: string[];
}

// Each signal's weight (sums to 100) and the human phrase shown when it is absent.
// Needs and offers dominate because the engine matches one against the other; the
// need-before-offer ordering mirrors the dashboard nudge (@/lib/enrichment-nudge).
const COMPONENTS: {
  key: keyof ProfileStrengthSignals;
  weight: number;
  missingLabel: string;
}[] = [
  { key: "lookingFor", weight: 30, missingLabel: "what they need" },
  { key: "canOffer", weight: 30, missingLabel: "what they offer" },
  { key: "hasProjects", weight: 20, missingLabel: "active work" },
  { key: "hasIndustry", weight: 10, missingLabel: "industry" },
  { key: "hasPrimaryContact", weight: 10, missingLabel: "a primary contact" },
];

const FAIR_THRESHOLD = 50;
const STRONG_THRESHOLD = 80;

/// PURE: score a focus company's profile completeness (0..100), classify it, and
/// list the still-missing signals in weight order. At/above STRONG_THRESHOLD the
/// caller hides the nudge — the profile is rich enough.
export function introProfileStrength(
  signals: ProfileStrengthSignals,
): ProfileStrength {
  let score = 0;
  const missing: string[] = [];
  for (const c of COMPONENTS) {
    if (signals[c.key]) score += c.weight;
    else missing.push(c.missingLabel);
  }

  const label: ProfileStrengthLabel =
    score >= STRONG_THRESHOLD ? "Strong" : score >= FAIR_THRESHOLD ? "Fair" : "Sparse";

  return { score, label, missing };
}

/// Whether the strength nudge is worth showing — only when the profile is still
/// incomplete (below STRONG_THRESHOLD), matching the prototype's early return.
export function isProfileIncomplete(strength: ProfileStrength): boolean {
  return strength.score < STRONG_THRESHOLD;
}
