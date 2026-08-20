import { describe, expect, it } from "vitest";

import {
  buildSopContext,
  parseSopAnswer,
  type SopAssistantInput,
} from "@/lib/sop-assistant";

// Unit tests for the PURE parts of the SOP assistant (knowledge layer, Step 3):
// buildSopContext folds the org's SOP block into the prompt, and parseSopAnswer
// defensively parses + validates the model's JSON — dropping hallucinated
// citations, clearing citations when the SOPs didn't cover the question, and
// collapsing garbage to an empty answer. No DB, no Anthropic.

const input = (over: Partial<SopAssistantInput> = {}): SopAssistantInput => ({
  orgName: "Hudson Valley EDC",
  question: "How do we onboard a new member?",
  grounding: "[SOP / playbook] Onboarding\nStep 1: welcome call.",
  ...over,
});

describe("buildSopContext", () => {
  it("includes the org name and the document grounding block", () => {
    const out = buildSopContext(input());
    expect(out).toContain("ORGANIZATION: Hudson Valley EDC");
    expect(out).toContain("UPLOADED DOCUMENTS");
    expect(out).toContain("[SOP / playbook] Onboarding");
    expect(out).toContain("Step 1: welcome call.");
  });
});

describe("parseSopAnswer", () => {
  const valid = new Set(["Onboarding", "Refund Policy"]);

  it("parses a grounded answer and keeps only real citations", () => {
    const raw = JSON.stringify({
      answer: "Start with a welcome call.",
      answered: true,
      citations: ["Onboarding", "Made Up Doc"],
    });
    const out = parseSopAnswer(raw, valid);
    expect(out.answer).toBe("Start with a welcome call.");
    expect(out.answered).toBe(true);
    expect(out.citations).toEqual(["Onboarding"]);
  });

  it("de-dupes repeated citations", () => {
    const raw = JSON.stringify({
      answer: "See both.",
      answered: true,
      citations: ["Onboarding", "Onboarding", "Refund Policy"],
    });
    expect(parseSopAnswer(raw, valid).citations).toEqual([
      "Onboarding",
      "Refund Policy",
    ]);
  });

  it("clears citations when the SOPs did not cover the question", () => {
    const raw = JSON.stringify({
      answer: "Your SOPs on file do not cover this.",
      answered: false,
      citations: ["Onboarding"],
    });
    const out = parseSopAnswer(raw, valid);
    expect(out.answered).toBe(false);
    expect(out.citations).toEqual([]);
    expect(out.answer).toContain("do not cover");
  });

  it("tolerates prose or code fences around the JSON", () => {
    const raw =
      "Here you go:\n```json\n" +
      JSON.stringify({ answer: "A.", answered: true, citations: [] }) +
      "\n```";
    expect(parseSopAnswer(raw, valid).answer).toBe("A.");
  });

  it("returns an empty answer for non-JSON garbage", () => {
    const out = parseSopAnswer("not json at all", valid);
    expect(out).toEqual({ answer: "", answered: false, citations: [] });
  });

  it("returns an empty answer for malformed JSON", () => {
    const out = parseSopAnswer('{"answer": "x", ', valid);
    expect(out).toEqual({ answer: "", answered: false, citations: [] });
  });
});
