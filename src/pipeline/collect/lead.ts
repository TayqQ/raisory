import { decodeEntities } from "./html-text";

/** The article opening is at most this many words and characters (D69). */
export const LEAD_MAX_WORDS = 150;
export const LEAD_MAX_CHARS = 1000;

/** Elements whose text is never part of the opening: media, embeds, quotes, headings. */
const DROPPED_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "figure",
  "figcaption",
  "blockquote",
  "iframe",
  "table",
  "aside",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

/** An element whose class names a caption, such as WordPress `wp-caption-text`. */
const CAPTION_ELEMENT =
  /<(p|span|div)\b[^>]*\bclass\s*=\s*["'][^"']*caption[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;

/** WordPress caption shortcodes left in a feed body. */
const CAPTION_SHORTCODE = /\[caption\b[^\]]*\][\s\S]*?\[\/caption\]/gi;

/** Tags that end a block of text. */
const BLOCK_BREAK =
  /<\/?(?:p|div|li|ul|ol|section|article)\b[^>]*>|<br\b[^>]*>/gi;

/** Lines a feed adds that are not part of the article. */
const BOILERPLATE: readonly RegExp[] = [/^the post\b.*\bappeared first on\b/i];

/**
 * A sentence end: `.`, `!` or `?`, optionally followed by closing quotes or
 * brackets, then a space and a character that does not start in lower case
 * (so "e.g. the" is not an end).
 */
const SENTENCE_END = /[.!?]["'”’)\]]*(?=\s+[^\sa-z]|\s*$)/g;

function dropElements(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROPPED_ELEMENTS) {
    out = out.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"),
      "\n",
    );
    // An unclosed or self-closing one (such as `<iframe ... />`).
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "\n");
  }
  return out.replace(CAPTION_ELEMENT, "\n").replace(CAPTION_SHORTCODE, "\n");
}

/** The body as plain-text paragraphs, without captions, embeds or feed boilerplate. */
export function bodyParagraphs(html: string): string[] {
  const text = decodeEntities(
    dropElements(html)
      .replace(BLOCK_BREAK, "\n")
      .replace(/<[^>]+>/g, " "),
  );
  return (
    text
      .split("\n")
      // A removed inline tag leaves a space before punctuation: "list ." becomes "list.".
      .map((line) =>
        line
          .replace(/\s+/g, " ")
          .replace(/ ([.,;:!?])(?=\s|$)/g, "$1")
          .trim(),
      )
      .filter((line) => line.length > 0)
      .filter((line) => !BOILERPLATE.some((pattern) => pattern.test(line)))
  );
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

function charCount(text: string): number {
  return Array.from(text).length;
}

function fits(text: string): boolean {
  return wordCount(text) <= LEAD_MAX_WORDS && charCount(text) <= LEAD_MAX_CHARS;
}

/** Cuts at the last whole word within both limits. */
function cutAtWord(text: string): string {
  const words = text.split(" ").slice(0, LEAD_MAX_WORDS);
  let out = words.join(" ");
  if (charCount(out) > LEAD_MAX_CHARS) {
    out = Array.from(out).slice(0, LEAD_MAX_CHARS).join("");
    const lastSpace = out.lastIndexOf(" ");
    if (lastSpace > 0) out = out.slice(0, lastSpace);
  }
  return out.trim();
}

/**
 * The first sentences of the text, within 150 words and 1,000 characters,
 * cut at a sentence end when one fits and at a word otherwise.
 */
export function cutLead(text: string): string {
  if (fits(text)) return text;
  let best = -1;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (!fits(text.slice(0, end))) break;
    best = end;
  }
  return best > 0 ? text.slice(0, best).trim() : cutAtWord(text);
}

/**
 * The opening of an article body as plain text, for extraction only (D69).
 * Null when nothing readable is left.
 */
export function articleLead(html: string): string | null {
  const paragraphs = bodyParagraphs(html);
  if (paragraphs.length === 0) return null;
  const lead = cutLead(paragraphs.join(" "));
  return lead.length > 0 ? lead : null;
}
