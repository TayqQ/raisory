import Link from "next/link";
import type { ReactNode } from "react";
import type { FundingFilters } from "@/core/read-models";
import { buttonClasses } from "@/components/ui/button";
import { serialiseFundingFilters } from "@/lib/funding-filters";

/**
 * First, Previous, "Page 2 of 9", Next and Last. First and Previous are left
 * out on page 1, Next and Last on the last page; their places stay reserved,
 * so the page count never shifts. On phones First and Last show only their
 * arrows (they keep their names for screen readers). Nothing is shown for a
 * single page.
 */
export function PageNav({
  page,
  pages,
  hrefFor,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}) {
  if (pages <= 1) return null;
  const linkClass = `${buttonClasses("secondary", "sm")} gap-1.5 max-sm:px-2.5`;
  const pageLink = (
    target: number,
    rel: "prev" | "next" | undefined,
    content: ReactNode,
  ) => (
    <Link rel={rel} href={hrefFor(target)} className={linkClass}>
      {content}
    </Link>
  );
  return (
    <nav
      aria-label="Pages"
      className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[13px] text-muted"
    >
      <div className="flex justify-start gap-2">
        {page > 1 ? (
          <>
            {pageLink(
              1,
              undefined,
              <>
                <span aria-hidden="true">«</span>
                <span className="max-sm:sr-only">First</span>
              </>,
            )}
            {pageLink(
              page - 1,
              "prev",
              <>
                <span aria-hidden="true">←</span> Previous
              </>,
            )}
          </>
        ) : null}
      </div>
      <span className="whitespace-nowrap tabular-nums">
        Page {page.toLocaleString("en-GB")} of {pages.toLocaleString("en-GB")}
      </span>
      <div className="flex justify-end gap-2">
        {page < pages ? (
          <>
            {pageLink(
              page + 1,
              "next",
              <>
                Next <span aria-hidden="true">→</span>
              </>,
            )}
            {pageLink(
              pages,
              undefined,
              <>
                <span className="max-sm:sr-only">Last</span>
                <span aria-hidden="true">»</span>
              </>,
            )}
          </>
        ) : null}
      </div>
    </nav>
  );
}

/** The funding list's pages, keeping every filter and the sort. */
export function Pagination({
  filters,
  total,
  page,
  pageSize,
}: {
  filters: FundingFilters;
  total: number;
  page: number;
  pageSize: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const hrefFor = (target: number) => {
    const query = serialiseFundingFilters({ ...filters, page: target });
    return query ? `/?${query}` : "/";
  };
  return <PageNav page={page} pages={pages} hrefFor={hrefFor} />;
}
