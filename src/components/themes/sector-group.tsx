import Link from "next/link";
import type { ReactNode } from "react";
import type { ThemeSummary } from "@/core/read-models";
import { MIN_THEME_COMPANIES } from "@/db/queries/trends";

function companiesLabel(count: number): string {
  return count === 1 ? "1 company" : `${count} companies`;
}

/**
 * One sector on the themes page, as a native `<details>` so it folds without
 * JavaScript. It starts folded. The summary shows the sector's distinct
 * companies, which is not the sum of the theme counts below it.
 */
export function SectorGroup({
  id,
  label,
  companyCount,
  themes,
}: {
  id: string;
  label: string;
  /** Distinct companies in the sector. */
  companyCount: number;
  themes: readonly ThemeSummary[];
}): ReactNode {
  return (
    <details id={id} className="motion-details group mt-8">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 border-b-2 border-ink pb-1 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="inline-block w-3 shrink-0 text-xs text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none"
        >
          ▶
        </span>
        <h2 className="min-w-0 flex-1 text-lg font-semibold">{label}</h2>
        <span className="shrink-0 text-sm tabular-nums text-muted">
          {companiesLabel(companyCount)}
        </span>
      </summary>
      <ul className="divide-y divide-line">
        {themes.map((theme) => (
          <li
            key={theme.slug}
            className="flex flex-wrap items-baseline justify-between gap-x-4 py-2"
          >
            <Link
              href={`/themes/${theme.slug}`}
              className="text-brand underline underline-offset-4"
            >
              {theme.name}
            </Link>
            <span className="text-sm text-muted">
              {companiesLabel(theme.companyCount)}
              {theme.companyCount < MIN_THEME_COMPANIES
                ? " · few companies"
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
