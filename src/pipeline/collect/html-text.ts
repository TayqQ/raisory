const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  pound: "£",
  euro: "€",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
};

/** Removes scripts, styles, comments and tags. Each tag becomes a space. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

/** Decodes numeric entities and a short list of named ones; others stay as written. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi,
    (match, raw: string) => {
      const body = raw.toLowerCase();
      if (body.startsWith("#x")) {
        return codePointOr(match, Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return codePointOr(match, Number.parseInt(body.slice(1), 10));
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

function codePointOr(fallback: string, code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return fallback;
  if (code >= 0xd800 && code <= 0xdfff) return fallback;
  return String.fromCodePoint(code);
}

/** Plain text on one line, or null when nothing is left. */
export function toPlainText(input: string, maxChars?: number): string | null {
  const collapsed = decodeEntities(stripHtml(input))
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length === 0) return null;
  if (maxChars === undefined) return collapsed;
  const chars = Array.from(collapsed);
  if (chars.length <= maxChars) return collapsed;
  return chars.slice(0, maxChars).join("");
}
