import { describe, expect, it } from "vitest";

import { buildIntroDraft } from "@/lib/intro-draft";

describe("buildIntroDraft", () => {
  const base = {
    host: "Brigham Farrand",
    introduce: "Hudson Timber Co",
    recipient: "Catskill Capital",
    headline: "Hudson Timber needs construction financing Catskill Capital funds.",
    talkingPoints: ["Both active in Ulster County", "Complementary deal sizes"],
    whyNow: "Catskill just closed a fund with capital to deploy.",
  };

  it("builds a subject naming both parties", () => {
    const d = buildIntroDraft(base);
    expect(d.subject).toBe("Intro: Hudson Timber Co \u2194 Catskill Capital");
  });

  it("introduces the introduce party and folds in the headline", () => {
    const d = buildIntroDraft(base);
    expect(d.body).toContain("introduce you to Hudson Timber Co.");
    expect(d.body).toContain(base.headline);
  });

  it("renders talking points as reason bullets", () => {
    const d = buildIntroDraft(base);
    expect(d.body).toContain("- Both active in Ulster County");
    expect(d.body).toContain("- Complementary deal sizes");
    // whyNow is not used when talking points are present.
    expect(d.body).not.toContain(base.whyNow);
  });

  it("falls back to whyNow when there are no talking points", () => {
    const d = buildIntroDraft({ ...base, talkingPoints: [] });
    expect(d.body).toContain(base.whyNow);
    expect(d.body).not.toContain("A few reasons");
  });

  it("keeps the scheduling slots and signs off with the host", () => {
    const d = buildIntroDraft(base);
    expect(d.body).toContain("\u2022 [Date/Time Option 1]");
    expect(d.body).toContain("\u2022 [Date/Time Option 3]");
    expect(d.body.trimEnd().endsWith("Brigham Farrand")).toBe(true);
  });

  it("omits blank/whitespace talking points and skips a missing headline", () => {
    const d = buildIntroDraft({
      ...base,
      headline: "  ",
      talkingPoints: ["  ", "Real point", ""],
    });
    expect(d.body).toContain("introduce you to Hudson Timber Co.\n");
    expect(d.body).toContain("- Real point");
    expect(d.body).not.toMatch(/- \s*\n/);
  });
});
