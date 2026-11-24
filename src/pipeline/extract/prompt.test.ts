import { describe, expect, it } from "vitest";
import { CURRENT_EXTRACTION_SCHEMA_NAME } from "@/core/extraction-schema";
import {
  EXTRACTION_PROMPT_VERSION,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompt";

describe("extraction prompt v4", () => {
  const system = buildSystemPrompt();

  it("is version v4 and still names the v2 schema", () => {
    expect(EXTRACTION_PROMPT_VERSION).toBe("v4");
    expect(CURRENT_EXTRACTION_SCHEMA_NAME).toBe("extraction_v2");
    expect(system).toContain(CURRENT_EXTRACTION_SCHEMA_NAME);
    expect(system).not.toContain("extraction_v1");
  });

  it("leaves out earlier rounds mentioned as history, and splits a multi-part raise", () => {
    expect(system).toContain("Report only what the text announces as new.");
    expect(system).toContain(
      "is not an event, even with an amount, date or investors",
    );
    expect(system).toContain("each part is its own event");
    expect(system).toContain("The 2024 Series B is history and is left out.");
  });

  it("asks for regionText as written, and never derived from the city", () => {
    expect(system).toContain("regionText");
    expect(system).toContain("copied as written");
    expect(system).toContain("Do not derive it from the city");
    for (const example of ["Scotland", "Wales", "Yorkshire", "Bavaria"]) {
      expect(system).toContain(`"${example}"`);
    }
  });

  it("asks for a bare city name only when the text states one", () => {
    expect(system).toContain('"Leeds-based" gives "Leeds"');
    expect(system).toContain("no county, region or country");
  });

  it("forbids guessing", () => {
    expect(system).toContain("Do not guess");
    expect(system).toContain("even if you believe you know the answer");
  });

  it("lists the banned generic tag words", () => {
    for (const word of ["startup", "technology", "innovation", "funding"]) {
      expect(system).toContain(`"${word}"`);
    }
    expect(system).toContain("places, round types or company names");
    expect(system).toContain("most specific first");
  });

  it("asks for the company's own name, from the article opening when needed", () => {
    expect(system).toContain("sometimes an article opening");
    expect(system).toContain(
      'never a description ("startup", "the company", "a London fintech")',
    );
    expect(system).toContain(
      'If the title and summary only say "a startup", take the name from the article opening.',
    );
    expect(system).toContain(
      "If no text names the company, leave the event out.",
    );
  });

  it("adds the article opening, labelled, only when there is one", () => {
    const item = {
      title: "Monzo alumni raise £1.8m for startup",
      summary: "The startup's team built scam models.",
      url: "https://example.com/story",
      sourceName: "Example Wire",
      publishedAt: null,
    };
    expect(buildUserPrompt(item)).not.toContain("Article opening");
    expect(buildUserPrompt({ ...item, lead: "  " })).not.toContain(
      "Article opening",
    );
    const user = buildUserPrompt({
      ...item,
      lead: "Acorda, founded by former Monzo engineers, has raised £1.8m.",
    });
    expect(user.split("\n").at(-1)).toBe(
      "Article opening: Acorda, founded by former Monzo engineers, has raised £1.8m.",
    );
  });
});
