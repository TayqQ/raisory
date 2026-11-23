/**
 * Placeholder company names (D69): generic descriptions such as "startup",
 * "a London fintech" or "the company" that a model can return when the text
 * it read never names the company. They must never be published as a name.
 *
 * A short curated list plus two patterns. Real names that contain these words
 * ("Startup Genome", "Fintech Farm", "Platform.sh") keep at least one word
 * that is not generic, so they pass.
 */

/** Head nouns that describe a company instead of naming it. */
const GENERIC_HEADS = new Set([
  "startup",
  "startups",
  "scaleup",
  "scaleups",
  "spinout",
  "spinouts",
  "spinoff",
  "company",
  "companies",
  "firm",
  "firms",
  "business",
  "businesses",
  "outfit",
  "venture",
  "platform",
  "app",
  "provider",
  "developer",
  "maker",
  "specialist",
  "operator",
  "brand",
  "team",
  "founders",
  "entity",
  "organisation",
  "organization",
  "enterprise",
  // Sector words used alone.
  "fintech",
  "healthtech",
  "insurtech",
  "proptech",
  "edtech",
  "regtech",
  "legaltech",
  "agritech",
  "agtech",
  "cleantech",
  "climatetech",
  "medtech",
  "biotech",
  "deeptech",
  "foodtech",
  "martech",
  "adtech",
  "govtech",
  "femtech",
  "wealthtech",
  "paytech",
  "spacetech",
  "tech",
  "technology",
  "software",
  "saas",
  "ai",
  "marketplace",
  "cybersecurity",
  "robotics",
]);

/** Words that only qualify a generic head: no name is made of these alone. */
const MODIFIERS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "its",
  "their",
  "one",
  "new",
  "young",
  "small",
  "early",
  "emerging",
  "local",
  "unnamed",
  "undisclosed",
  "unknown",
  "anonymous",
  "stealth",
  "mystery",
  "secretive",
  "deep",
  "digital",
  "online",
  "mobile",
  "green",
  "clean",
  "climate",
  "health",
  "b2b",
  "b2c",
  "d2c",
  "uk",
  "us",
  "u.s.",
  "eu",
  "british",
  "english",
  "scottish",
  "welsh",
  "irish",
  "american",
  "european",
  "french",
  "german",
  "dutch",
  "nordic",
  "swedish",
  "danish",
  "norwegian",
  "finnish",
  "spanish",
  "italian",
  "swiss",
  "israeli",
  "indian",
  "global",
  "international",
  "london",
]);

/** Compound modifiers such as "London-based", "VC-backed" or "early-stage". */
const MODIFIER_SUFFIX =
  /-(?:based|headquartered|born|founded|backed|powered|focused|led|stage|mode|native|first)$/;

/** Whole names that are never a company name. */
const PLACEHOLDER_NAMES = new Set([
  "unnamed",
  "undisclosed",
  "unknown",
  "anonymous",
  "stealth",
  "n/a",
  "na",
  "none",
  "null",
  "tbc",
  "tba",
  "not named",
  "not disclosed",
  "in stealth",
]);

const LEADING_DETERMINERS = new Set(["a", "an", "the", "this", "its", "their"]);

function cleanToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^["'“”(\[]+|["'“”)\],;:!?]+$/g, "")
    .replace(/'s$/, "")
    .replace(/\.$/, "");
}

/** "start-up" and "fin-tech" are the same words as "startup" and "fintech". */
function headForm(token: string): string {
  return token.replace(/-/g, "");
}

function isGeneric(token: string): boolean {
  return GENERIC_HEADS.has(token) || GENERIC_HEADS.has(headForm(token));
}

function isModifier(token: string): boolean {
  return MODIFIERS.has(token) || MODIFIER_SUFFIX.test(token);
}

function startsLowerCase(word: string): boolean {
  const first = word.replace(/^["'“”‘’(\[]+/, "").charAt(0);
  return (
    first !== "" &&
    first === first.toLowerCase() &&
    first !== first.toUpperCase()
  );
}

function startsUpperCase(word: string): boolean {
  const first = word.replace(/^["'“”‘’(\[]+/, "").charAt(0);
  return (
    first !== "" &&
    first === first.toUpperCase() &&
    first !== first.toLowerCase()
  );
}

/**
 * True when `name` describes a company rather than naming it: an empty name,
 * a curated placeholder ("unnamed", "stealth"), only generic and qualifying
 * words ("startup", "fintech", "the company", "London-based scale-up"), or
 * an article or a capitalised word followed by a lower-case generic head
 * ("a Manchester startup", "Monzo-backed startup", "London startup").
 */
export function isPlaceholderCompanyName(name: string): boolean {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return true;
  const tokens = words.map(cleanToken).filter((token) => token.length > 0);
  if (tokens.length === 0) return true;
  if (PLACEHOLDER_NAMES.has(tokens.join(" "))) return true;

  if (
    tokens.some(isGeneric) &&
    tokens.every((token) => isGeneric(token) || isModifier(token))
  ) {
    return true;
  }

  // "a Leeds startup", "the Berlin company", "London startup": a description
  // ending in a lower-case generic head, whatever the place in front of it.
  const last = words[words.length - 1] ?? "";
  const lastToken = tokens[tokens.length - 1] ?? "";
  if (words.length > 1 && isGeneric(lastToken) && startsLowerCase(last)) {
    const first = tokens[0] ?? "";
    if (LEADING_DETERMINERS.has(first)) return true;
    if (words.slice(0, -1).some(startsUpperCase)) return true;
  }
  return false;
}
