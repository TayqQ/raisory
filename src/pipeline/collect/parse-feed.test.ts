import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFeed } from "./parse-feed";

const feedsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/feeds",
);

function readFeed(name: string): string {
  return readFileSync(join(feedsDir, name), "utf8");
}

describe("parseFeed", () => {
  it("parses RSS 2.0 items, keeping the guid and the raw link", () => {
    const items = parseFeed(readFeed("rss2-basic.xml"), "example-feed");

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      sourceSlug: "example-feed",
      externalId: "example-robotics-seed",
      url: "https://example.com/robotics?utm_source=rss&utm_medium=feed",
      title: "Example Robotics raises £4M seed",
      summary: "Example Robotics raised a seed round for warehouse robots.",
      publishedAt: new Date("2026-10-08T09:30:00.000Z"),
      lead: null,
    });
  });

  it("falls back to the link when guid is missing and drops an invalid date", () => {
    const items = parseFeed(readFeed("rss2-basic.xml"), "example-feed");
    const second = items[1];

    expect(second).toMatchObject({
      externalId: "https://example.com/northwind-london",
      url: "https://example.com/northwind-london",
      title: "Northwind Labs opens a London office",
      summary: "No guid on this item.",
      publishedAt: null,
    });
  });

  it("strips HTML, decodes entities, and collapses whitespace", () => {
    const items = parseFeed(
      readFeed("rss2-html-description.xml"),
      "example-feed",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toBe(
      "Tom & Jerry <b>bold</b> raised £4M in a seed round.",
    );
    expect(items[0]?.summary).not.toContain("alert");
  });

  it("parses Atom entries, preferring alternate links and published dates", () => {
    const items = parseFeed(readFeed("atom-basic.xml"), "example-feed");

    expect(items).toEqual([
      {
        sourceSlug: "example-feed",
        externalId: "tag:example.com,2026:robotics-seed",
        url: "https://example.com/atom/robotics",
        title: "Example Robotics raises £4M seed",
        summary: "Synthetic summary for Example Robotics.",
        publishedAt: new Date("2026-10-08T09:30:00.000Z"),
        lead: null,
      },
      {
        sourceSlug: "example-feed",
        externalId: "tag:example.com,2026:northwind",
        url: "https://example.com/atom/northwind",
        title: "Northwind Labs launches a warehouse pilot",
        summary: "Only content, no summary element.",
        publishedAt: new Date("2026-10-07T15:00:00.000Z"),
        lead: null,
      },
    ]);
  });

  it("skips malformed items and keeps the others", () => {
    const items = parseFeed(readFeed("malformed-item.xml"), "example-feed");

    expect(items.map((item) => item.externalId)).toEqual([
      "kept-first",
      "kept-last",
    ]);
    expect(items[0]?.summary).toBe("Kept before the bad items.");
    expect(items[1]?.summary).toBe("Kept after the bad items.");
  });

  it("limits a summary to 1,000 characters", () => {
    const summary = `${"a".repeat(1000)}MORE`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><item>
  <title>Long summary</title>
  <link>https://example.com/long</link>
  <description><![CDATA[${summary}]]></description>
</item></channel></rss>`;

    const items = parseFeed(xml, "example-feed");

    expect(items[0]?.summary).toHaveLength(1000);
    expect(items[0]?.summary?.endsWith("MORE")).toBe(false);
  });

  describe("article opening (lead)", () => {
    it("keeps the opening of content:encoded, cut and free of boilerplate", () => {
      const [item, plain] = parseFeed(
        readFeed("rss2-content-encoded.xml"),
        "example-feed",
      );

      // The summary never names the company; the body opens with the name.
      expect(item?.summary).not.toContain("Acorda");
      expect(item?.lead).toBe(
        [
          "Acorda, founded by former Monzo engineers, has raised £1.8m in a pre-seed round.",
          "The founders spent years at the digital bank building machine-learning models to catch scams.",
          "They said the missing piece was always data, because banks know their own customers but very little about who they are paying.",
          "The new startup is building scam-prevention technology for banks and will use the round to deliver trials with fintech partners.",
          "Acorda said its product lets payment providers see risk on both sides of a payment before money moves.",
          "The company said its goal is a product that people working in financial crime enjoy using.",
          "The round was led by Example Ventures, with investment also from a solo GP fund and a group of angels.",
          "The founders thanked the investors in a social media post.",
        ].join(" "),
      );
      expect(item?.lead).not.toMatch(/caption|appeared first on|Another story/);
      expect(plain?.lead).toBeNull();
    });

    it("cuts a long body at a sentence end within 150 words and 1,000 characters", () => {
      const sentence =
        "Example Robotics builds warehouse robots for small shops.";
      const body = Array.from({ length: 40 }, () => `<p>${sentence}</p>`).join(
        "",
      );
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
  <title>Long body</title>
  <link>https://example.com/long-body</link>
  <description>Short summary.</description>
  <content:encoded><![CDATA[${body}]]></content:encoded>
</item></channel></rss>`;

      const lead = parseFeed(xml, "example-feed")[0]?.lead ?? "";

      expect(lead.split(" ").length).toBeLessThanOrEqual(150);
      expect(Array.from(lead).length).toBeLessThanOrEqual(1000);
      expect(lead.endsWith("small shops.")).toBe(true);
      // 17 sentences of 57 characters plus spaces is the most that fits.
      expect(lead.split(sentence).length - 1).toBe(17);
    });

    it("uses Atom content as the body only when it is longer than the summary", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Longer content</title>
    <id>longer</id>
    <link href="https://example.com/longer"/>
    <summary>A short summary.</summary>
    <content type="html"><![CDATA[<p>Northwind Labs opened a pilot. It runs in two warehouses.</p>]]></content>
  </entry>
  <entry>
    <title>Shorter content</title>
    <id>shorter</id>
    <link href="https://example.com/shorter"/>
    <summary>A summary that is longer than the content element.</summary>
    <content type="html"><![CDATA[<p>Short.</p>]]></content>
  </entry>
</feed>`;

      const [longer, shorter] = parseFeed(xml, "example-feed");

      expect(longer?.lead).toBe(
        "Northwind Labs opened a pilot. It runs in two warehouses.",
      );
      expect(shorter?.lead).toBeNull();
    });
  });
});
