import type { RoundType } from "@/core/enums";

export type StageBucket = "early" | "seed" | "venture" | "late" | "other";

const BUCKETS: Readonly<Record<RoundType, StageBucket>> = {
  pre_seed: "early",
  seed: "seed",
  series_a: "venture",
  series_b: "venture",
  series_c: "late",
  series_d_plus: "late",
  growth: "late",
  debt: "other",
  grant: "other",
  unknown: "other",
};

/** The colour bucket for a round type. The only copy of this mapping. */
export function stageBucket(roundType: RoundType): StageBucket {
  return BUCKETS[roundType];
}

/** The buckets, early to late, then other. */
export const STAGE_BUCKETS: readonly StageBucket[] = [
  "early",
  "seed",
  "venture",
  "late",
  "other",
];

/**
 * Tailwind classes for a bucket's label: the soft stage fill with the
 * stage-coloured text on it (`--stage-*-soft` and `--stage-*-ink` in
 * globals.css, at least 4.5:1 in both themes). Written out in full so
 * Tailwind finds them.
 */
export const STAGE_LABEL_CLASSES: Readonly<Record<StageBucket, string>> = {
  early: "bg-stage-early-soft text-stage-early-ink",
  seed: "bg-stage-seed-soft text-stage-seed-ink",
  venture: "bg-stage-venture-soft text-stage-venture-ink",
  late: "bg-stage-late-soft text-stage-late-ink",
  other: "bg-stage-other-soft text-stage-other-ink",
};
