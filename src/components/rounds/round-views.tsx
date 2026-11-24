import Link from "next/link";
import type { FundingFilters, FundingRow } from "@/core/read-models";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ListView } from "@/lib/view-preference";
import { RoundCards } from "./round-cards";
import { RoundList } from "./round-list";

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The rounds in the chosen view. The server cannot know the screen width, so
 * Cards is rendered next to the list and CSS picks one: the list shows under
 * 768 px (phones). With nothing to show it says why: no rounds at all, or none
 * for the named filters, with "Clear all".
 */
export function RoundViews({
  rows,
  view,
  filters,
  appliedLabels,
  clearHref,
  now,
}: {
  rows: readonly FundingRow[];
  view: ListView;
  filters: FundingFilters;
  /** The applied filters by name, as the chips show them. */
  appliedLabels: readonly string[];
  clearHref: string;
  now?: Date;
}) {
  if (rows.length === 0) {
    if (appliedLabels.length === 0) {
      return (
        <EmptyState title="No funding rounds yet">
          Rounds appear here once collected articles have been processed. The{" "}
          <Link
            href="/status"
            className="text-brand underline underline-offset-4"
          >
            status page
          </Link>{" "}
          shows how far that has got.
        </EmptyState>
      );
    }
    return (
      <EmptyState
        title="No rounds match these filters"
        action={
          <Button href={clearHref} size="sm">
            Clear all
          </Button>
        }
      >
        Nothing matches {joinLabels(appliedLabels)}. Try removing one.
      </EmptyState>
    );
  }

  if (view === "cards") {
    return (
      <>
        <div className="md:hidden">
          <RoundList rows={rows} filters={filters} now={now} />
        </div>
        <div className="max-md:hidden">
          <RoundCards rows={rows} now={now} />
        </div>
      </>
    );
  }
  return <RoundList rows={rows} filters={filters} now={now} />;
}
