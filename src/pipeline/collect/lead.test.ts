import { describe, expect, it } from "vitest";
import {
  LEAD_MAX_CHARS,
  LEAD_MAX_WORDS,
  articleLead,
  bodyParagraphs,
  cutLead,
} from "./lead";

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

describe("bodyParagraphs", () => {
  it("drops captions, embeds, quotes, headings and the feed's 'The post' line", () => {
    const html = `
      <figure><img src="x.jpg"/><figcaption>A caption</figcaption></figure>
      <div class="wp-caption"><img src="y.jpg"/><p class="wp-caption-text">Another caption</p></div>
      [caption id="1"]<img src="z.jpg"/> Shortcode caption[/caption]
      <h2>Key points</h2>
      <p>First paragraph.</p>
      <blockquote class="wp-embedded-content"><p><a href="#">Related story</a></p></blockquote>
      <p><iframe src="https://example.com/embed" title="Embedded story"></iframe></p>
      <script>var x = "no";</script>
      <p>Second&nbsp;paragraph &amp; <a href="#">more</a> .</p>
      <p>The post <a href="#">Headline</a> appeared first on <a href="#">Site</a>.</p>`;

    expect(bodyParagraphs(html)).toEqual([
      "First paragraph.",
      "Second paragraph & more.",
    ]);
  });
});

describe("cutLead", () => {
  it("keeps a short text whole", () => {
    expect(cutLead("One sentence. Two sentences.")).toBe(
      "One sentence. Two sentences.",
    );
  });

  it("cuts at the last sentence end within 150 words", () => {
    const sentence = "This sentence has exactly eight words in it.";
    const text = Array.from({ length: 30 }, () => sentence).join(" ");
    const lead = cutLead(text);

    expect(words(lead)).toBeLessThanOrEqual(LEAD_MAX_WORDS);
    expect(words(lead)).toBe(144);
    expect(lead.endsWith("in it.")).toBe(true);
  });

  it("cuts at the last sentence end within 1,000 characters", () => {
    const sentence = `${"Supercalifragilistic ".repeat(9)}end.`;
    const text = Array.from({ length: 10 }, () => sentence).join(" ");
    const lead = cutLead(text);

    expect(Array.from(lead).length).toBeLessThanOrEqual(LEAD_MAX_CHARS);
    expect(lead.endsWith("end.")).toBe(true);
  });

  it("does not end a sentence at a decimal point or before a lower-case word", () => {
    const filler = Array.from({ length: 160 }, () => "Word").join(" ");
    const text = `It raised £1.8m, e.g. from angels. ${filler}.`;

    expect(cutLead(text)).toBe("It raised £1.8m, e.g. from angels.");
  });

  it("cuts at a word when no sentence end fits", () => {
    const text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    const lead = cutLead(text);

    expect(words(lead)).toBe(LEAD_MAX_WORDS);
    expect(lead.endsWith("w149")).toBe(true);
  });
});

describe("articleLead", () => {
  it("is null for a body with no readable text", () => {
    expect(articleLead('<div id="ad"></div><img src="x.jpg"/>')).toBeNull();
  });
});
