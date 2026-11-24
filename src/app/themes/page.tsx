import type { Metadata } from "next";
import { SECTOR_LABELS, type Sector } from "@/core/sectors";
import type { ThemeSummary } from "@/core/read-models";
import { RankedBars } from "@/components/ui/ranked-bars";
import { OpenOnHash } from "@/components/themes/open-on-hash";
import { SectorGroup } from "@/components/themes/sector-group";
import { listSectorCompanyCounts, listThemes } from "@/db/queries/themes";
import { MIN_THEME_COMPANIES } from "@/db/queries/trends";
import { getWebDb } from "@/db/web";
import { cached } from "@/lib/cached";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Themes" };

const NO_SECTOR = "No sector yet";

function groupId(sector: Sector | null): string {
  return `sector-${sector ?? "none"}`;
}

export default async function ThemesPage() {
  const [themes, sectorCounts] = await Promise.all([
    cached(() => listThemes(getWebDb()), ["themes", "active"]),
    cached(() => listSectorCompanyCounts(getWebDb()), ["themes", "sectors"]),
  ]);
  const groups = new Map<Sector | null, ThemeSummary[]>();
  for (const theme of themes) {
    groups.set(theme.sector, [...(groups.get(theme.sector) ?? []), theme]);
  }
  const distinct = new Map(
    sectorCounts.map((row) => [row.sector, row.companyCount]),
  );
  const labelOf = (sector: Sector | null): string =>
    sector ? SECTOR_LABELS[sector] : NO_SECTOR;
  // Companies with no sector are mostly grant companies, far more than any
  // sector, so a bar for them would flatten the comparison. They get a note.
  const unsectored = distinct.get(null) ?? 0;
  const bars = sectorCounts
    .filter((row) => row.sector !== null && groups.has(row.sector))
    .map((row) => ({
      label: labelOf(row.sector),
      value: row.companyCount,
      valueLabel: String(row.companyCount),
      href: `#${groupId(row.sector)}`,
    }));

  return (
    <main>
      <h1 className="sr-only">Themes</h1>
      <p className="text-[13px] text-muted">
        Groups of related companies, by sector. Themes with fewer than{" "}
        {MIN_THEME_COMPANIES} companies are listed but kept out of the trend
        tables.
      </p>
      {themes.length === 0 ? (
        <p className="mt-8 border-y border-line py-8 text-muted">
          No themes yet. They appear once enough companies have been collected.
        </p>
      ) : (
        <>
          <section aria-label="Sectors by size" className="mt-6">
            <h2 className="text-sm font-semibold">Sectors by size</h2>
            <p className="mb-3 text-[13px] text-muted">
              Companies in each sector. A company in two themes of one sector
              counts once.
            </p>
            <RankedBars items={bars} />
            {unsectored > 0 && groups.has(null) ? (
              <p className="mt-3 text-[13px] text-muted">
                <a
                  href={`#${groupId(null)}`}
                  className="underline underline-offset-4"
                >
                  {unsectored.toLocaleString("en-GB")}{" "}
                  {unsectored === 1 ? "company has" : "companies have"} no
                  sector yet
                </a>
                , mostly from grants.
              </p>
            ) : null}
            <OpenOnHash />
          </section>
          {[...groups].map(([sector, group]) => (
            <SectorGroup
              key={sector ?? "none"}
              id={groupId(sector)}
              label={labelOf(sector)}
              companyCount={distinct.get(sector) ?? 0}
              themes={group}
            />
          ))}
        </>
      )}
    </main>
  );
}
