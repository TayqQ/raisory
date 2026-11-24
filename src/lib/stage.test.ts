import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUND_TYPES } from "@/core/enums";
import { STAGE_BUCKETS, STAGE_LABEL_CLASSES, stageBucket } from "./stage";

describe("stageBucket", () => {
  it.each([
    ["pre_seed", "early"],
    ["seed", "seed"],
    ["series_a", "venture"],
    ["series_b", "venture"],
    ["series_c", "late"],
    ["series_d_plus", "late"],
    ["growth", "late"],
    ["debt", "other"],
    ["grant", "other"],
    ["unknown", "other"],
  ] as const)("%s is %s", (roundType, bucket) => {
    expect(stageBucket(roundType)).toBe(bucket);
  });

  it("covers every round type", () => {
    for (const t of ROUND_TYPES) expect(stageBucket(t)).toBeDefined();
  });

  it("lists every bucket once", () => {
    const used = new Set(ROUND_TYPES.map(stageBucket));
    expect(new Set(STAGE_BUCKETS)).toEqual(used);
    expect(STAGE_BUCKETS).toHaveLength(used.size);
  });
});

// The stage label colours, read from globals.css so the test checks what ships.
const css = readFileSync(
  path.join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function declarations(body: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) vars.set(name, value.trim());
  }
  return vars;
}

/** The body of the first block that opens with `selector` and contains `marker`. */
function block(selector: RegExp, marker: string): Map<string, string> {
  for (const match of css.matchAll(
    new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, "g"),
  )) {
    if (match[1]?.includes(marker)) return declarations(match[1]);
  }
  throw new Error(`no ${selector.source} block with ${marker}`);
}

const THEMES: ReadonlyArray<[string, Map<string, string>]> = [
  ["light", block(/:root/, "--paper:")],
  // The system dark theme and the chosen dark theme must both pass.
  ["dark (system)", block(/:root:not\(\[data-theme="light"\]\)/, "--paper:")],
  ["dark (chosen)", block(/:root\[data-theme="dark"\]/, "--paper:")],
];

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function hex(vars: Map<string, string>, name: string): string {
  const value = vars.get(name);
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} is not a six-digit hex colour`);
  }
  return value;
}

describe.each(THEMES)("stage label colours, %s theme", (_name, vars) => {
  it.each(STAGE_BUCKETS)(
    "%s text on its fill is at least 4.5:1 (WCAG 1.4.3)",
    (bucket) => {
      const ink = hex(vars, `--stage-${bucket}-ink`);
      const fill = hex(vars, `--stage-${bucket}-soft`);
      expect(contrast(ink, fill)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("gives every bucket its own fill and text colour", () => {
    const fills = STAGE_BUCKETS.map((b) => hex(vars, `--stage-${b}-soft`));
    const inks = STAGE_BUCKETS.map((b) => hex(vars, `--stage-${b}-ink`));
    expect(new Set(fills).size).toBe(STAGE_BUCKETS.length);
    expect(new Set(inks).size).toBe(STAGE_BUCKETS.length);
  });
});

describe("stage label classes", () => {
  it.each(STAGE_BUCKETS)("%s uses utilities globals.css defines", (bucket) => {
    for (const name of STAGE_LABEL_CLASSES[bucket].split(" ")) {
      const token = name.replace(/^(bg|text)-/, "");
      expect(css).toMatch(new RegExp(`--color-${token}:\\s*var\\(--`));
    }
  });
});
