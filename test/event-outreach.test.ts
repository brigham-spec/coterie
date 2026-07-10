import { describe, expect, test } from "vitest";

import {
  buildOutreachPrompt,
  cleanOutreachDraft,
  type OutreachInput,
} from "@/lib/event-outreach";

// Pure-logic tests for the event-outreach engine: cleanOutreachDraft must strip
// the wrappers the model sometimes adds (code fences, a stray Subject line, a
// layer of quotes) and treat empty as failure; buildOutreachPrompt must only
// surface fields that are present and switch its "don't invent history" guidance
// on whether any real context exists.

describe("cleanOutreachDraft", () => {
  test("trims and passes clean text through", () => {
    expect(cleanOutreachDraft("  Hello, come to the dinner.  ")).toBe(
      "Hello, come to the dinner.",
    );
  });

  test("unwraps a fenced code block", () => {
    expect(cleanOutreachDraft("```email\nCome join us on Thursday.\n```")).toBe(
      "Come join us on Thursday.",
    );
  });

  test("drops a leading Subject line", () => {
    expect(
      cleanOutreachDraft("Subject: You're invited\n\nWe'd love to see you there."),
    ).toBe("We'd love to see you there.");
  });

  test("peels one layer of wrapping quotes", () => {
    expect(cleanOutreachDraft('"The room needs your voice."')).toBe(
      "The room needs your voice.",
    );
    expect(cleanOutreachDraft("“Smart quotes too.”")).toBe("Smart quotes too.");
  });

  test("returns empty string for blank input", () => {
    expect(cleanOutreachDraft("")).toBe("");
    expect(cleanOutreachDraft("   \n  ")).toBe("");
  });
});

function input(over: Partial<OutreachInput> = {}): OutreachInput {
  return {
    orgName: "HVEDC",
    host: "Brigham",
    event: { name: "Mill Salon", date: "Aug 1", venue: "The Foundry", theme: "Redevelopment" },
    guest: {
      name: "Pat Rivera",
      org: "Riverside Mills",
      title: "Principal",
      industry: "Developer",
      seeking: null,
      brings: null,
      focusAreas: [],
      recentTopics: [],
    },
    confirmedGuests: [],
    ...over,
  };
}

describe("buildOutreachPrompt", () => {
  test("names the host, org, guest, and event", () => {
    const p = buildOutreachPrompt(input());
    expect(p).toContain("from Brigham at HVEDC to Pat Rivera at Riverside Mills");
    expect(p).toContain('"Mill Salon"');
    expect(p).toContain("Aug 1");
    expect(p).toContain("The Foundry");
  });

  test("omits fields that are absent", () => {
    const p = buildOutreachPrompt(input());
    // seeking/brings are null → their labels should not appear in the context block.
    expect(p).not.toContain("Seeking:");
    expect(p).not.toContain("Brings:");
  });

  test("warns against inventing history when context is sparse", () => {
    const p = buildOutreachPrompt(input());
    expect(p).toContain("Do NOT invent past meetings");
  });

  test("uses the rich-context note when real signal is present", () => {
    const p = buildOutreachPrompt(
      input({
        guest: {
          ...input().guest,
          seeking: "a capital partner",
          recentTopics: ["Toured the mill site"],
        },
      }),
    );
    expect(p).toContain("Real context on this guest is available");
    expect(p).toContain("Seeking: a capital partner");
    expect(p).toContain("Recent topic: Toured the mill site");
  });

  test("lists other confirmed guests when supplied", () => {
    const p = buildOutreachPrompt(input({ confirmedGuests: ["Jane Doe", "Sam Fox"] }));
    expect(p).toContain("Others already attending: Jane Doe, Sam Fox");
  });
});
