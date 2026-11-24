import type { RoundType } from "@/core/enums";
import { formatRoundType } from "@/lib/format";
import { STAGE_LABEL_CLASSES, stageBucket } from "@/lib/stage";

/**
 * The stage as a filled label: the whole label takes the stage's soft fill,
 * with stage-coloured text on it (at least 4.5:1 in both themes). The text is
 * always present, so colour is never the only cue. `label` overrides the text
 * (for example "Series F") while the colour still comes from the round type.
 */
export function StageChip({
  roundType,
  label,
}: {
  roundType: RoundType;
  label?: string;
}) {
  const bucket = stageBucket(roundType);
  return (
    <span
      data-stage={bucket}
      className={`inline-flex items-center whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-semibold ${STAGE_LABEL_CLASSES[bucket]}`}
    >
      {label ?? formatRoundType(roundType)}
    </span>
  );
}
