"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition, type MouseEvent } from "react";
import {
  SUMMARY_PERIODS,
  SUMMARY_PERIOD_LABELS,
  SUMMARY_PERIOD_OPTIONS,
  summaryPeriodCookie,
  type SummaryPeriod,
} from "@/lib/view-preference";

/** A plain left click, which the page may handle itself. */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** Keeps the period for this session, so links without `?summary=` keep it. */
function rememberPeriod(period: SummaryPeriod) {
  try {
    document.cookie = summaryPeriodCookie(period);
  } catch {
    // Cookies can be blocked; the URL still carries the choice.
  }
}

/**
 * The summary's period (7 days, 30 days, 90 days or 12 months) as a segmented
 * row of links to `?summary=`, so it works without JavaScript and the URL can
 * be shared. With JavaScript a click also remembers the period for this
 * session (filters and paging drop `?summary=`), shows the choice at once and
 * replaces the URL without a history entry or a jump to the top.
 */
export function SummaryPeriodLinks({
  period,
  hrefs,
}: {
  period: SummaryPeriod;
  /** The current page with each period set. */
  hrefs: Readonly<Record<SummaryPeriod, string>>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<SummaryPeriod, SummaryPeriod>(
    period,
    (_current, next) => next,
  );

  function choose(event: MouseEvent<HTMLAnchorElement>, next: SummaryPeriod) {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    rememberPeriod(next);
    if (next === shown) return;
    startTransition(() => {
      setShown(next);
      router.replace(hrefs[next], { scroll: false });
    });
  }

  return (
    <div
      role="group"
      aria-label="Summary period"
      className="inline-flex max-w-full rounded-[var(--radius-sm)] border border-line-strong bg-surface-sunk p-0.5"
    >
      {SUMMARY_PERIODS.map((option) => {
        const current = option === shown;
        return (
          <Link
            key={option}
            href={hrefs[option]}
            prefetch={false}
            scroll={false}
            title={SUMMARY_PERIOD_LABELS[option]}
            aria-current={current ? "true" : undefined}
            onClick={(event) => choose(event, option)}
            className={`inline-flex h-7 items-center whitespace-nowrap rounded-[4px] px-2 text-[13px] font-medium transition-colors duration-[120ms] ease-out motion-reduce:transition-none sm:px-2.5 ${
              current
                ? "bg-surface text-ink shadow-[var(--shadow-1)]"
                : "text-muted hover:text-ink"
            }`}
          >
            {SUMMARY_PERIOD_OPTIONS[option]}
          </Link>
        );
      })}
    </div>
  );
}
