"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { useEnhanced } from "@/components/filters/filter-controls";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  parseListView,
  viewCookie,
  withViewParam,
  type ListView,
} from "@/lib/view-preference";

const OPTIONS = [
  { value: "list", label: "List" },
  { value: "cards", label: "Cards" },
] as const;

/**
 * List · Cards, next to Sort. A change is remembered in the `raisory_view`
 * cookie and written to `?view=` with `router.replace`, so the server renders
 * the new view without a reload or a history entry. Without JavaScript the
 * options are links to `?view=`. Hidden on phones, which always show the
 * stacked list.
 */
export function ViewSwitch({
  view,
  href,
}: {
  view: ListView;
  /** The current path and query, for the no-JavaScript links. */
  href: string;
}) {
  const enhanced = useEnhanced();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic<ListView, ListView>(
    view,
    (_current, next) => next,
  );

  function choose(value: string) {
    const next = parseListView(value);
    if (!next || next === shown) return;
    try {
      document.cookie = viewCookie(next);
    } catch {
      // Cookies can be blocked; the URL still carries the choice.
    }
    const current = `${window.location.pathname}${window.location.search}`;
    startTransition(() => {
      setShown(next);
      router.replace(withViewParam(current, next), { scroll: false });
    });
  }

  return (
    <div className="flex items-center gap-2 max-md:hidden">
      <span className="text-[13px] text-muted" aria-hidden="true">
        View
      </span>
      {enhanced ? (
        <SegmentedControl
          label="View"
          options={OPTIONS}
          value={shown}
          onChange={choose}
        />
      ) : (
        <div
          role="group"
          aria-label="View"
          className="inline-flex rounded-[var(--radius-sm)] border border-line-strong bg-surface-sunk p-0.5"
        >
          {OPTIONS.map((option) => {
            const current = option.value === shown;
            const base =
              "inline-flex h-7 items-center whitespace-nowrap rounded-[4px] px-3 text-[13px] font-medium";
            return (
              <Link
                key={option.value}
                href={withViewParam(href, option.value)}
                prefetch={false}
                aria-current={current ? "true" : undefined}
                className={`${base} ${
                  current
                    ? "bg-surface text-ink shadow-[var(--shadow-1)]"
                    : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
