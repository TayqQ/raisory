# 092 Themes overview, investor filter fix and About page review

- **Tier:** 1-2 (UI and copy). **Suggested model:** Claude Sonnet.
- **Depends on:** nothing open. **Wave:** UX polish.

## Why (Taylor's review, 24 November 2026)
- On the investors page, the dropdown arrows sit tight against the right edge of the select boxes.
- The themes page is one long list. The sector groups can't be folded, they don't show how many companies each holds, and nothing shows how the sectors compare in size.
- The About page may have drifted from what the site does now. The list of sources, for example, may be out of date.

## Goal
1. **Dropdown arrows:** the select chevron has the same inset from the right edge as the text has from the left (about 12-16 px), and the text never runs under it. Fix it at the shared style if the select is shared, so every page that uses it is fixed. Check the funding, investors, acquisitions and trends pages.
2. **Themes page:**
   - **Collapsible groups.** Each sector group can be collapsed. Use `<details>`/`<summary>` so it works without JavaScript, all open by default. The summary line shows the sector name and its total number of distinct companies. A company in two themes of one sector counts once. Use a query for this, not a sum of the theme counts, and add a test that proves the distinct count.
   - **A size comparison at the top:** a horizontal bar per sector, showing its distinct companies, sorted largest first, labelled with the name and the number. Reuse `src/components/ui/ranked-bars.tsx` if it fits. Follow the existing chart styling, and use colours that work in light and dark themes. Each bar links to its group on the page.
3. **About page:** compare every factual statement with the code and docs as they are now, and fix what is wrong or missing:
   - sources: the feeds and APIs actually collected (`src/pipeline/sources/` or the source config, `docs/sources.md`);
   - how often things run (`.github/workflows/ingest.yml`, `daily.yml`);
   - the model and spend cap;
   - Companies House and Form D linking;
   - the placeholder-name guard and retry (D69);
   - flags.

   List every change you made, with the reason, in your report. Keep the existing tone and structure. Another task adds a "How we find company websites" section to this page, so don't add one.

## Read first
- `AGENTS.md`, `docs/decisions.md`, `docs/sources.md`, `docs/deployment.md`, `README.md`
- `src/app/themes/page.tsx`, `src/db/queries/themes.ts`, `src/app/investors/page.tsx`, `src/components/theme-select.tsx`, `src/components/filters/*`, `src/app/about/page.tsx`

## Files you may create or change
`src/app/themes/page.tsx`, `src/db/queries/themes.ts` and its test, new components under `src/components/themes/`, `src/components/ui/ranked-bars.tsx` (additive changes only), the shared select styling (wherever it lives: a component or `src/app/globals.css`), `src/app/investors/page.tsx`, `src/components/theme-select.tsx`, `src/app/about/page.tsx`.

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass.
- The distinct-count query has a test where one company is in two themes of the same sector.
- Checked in the browser at 375 px and 1280 px, light and dark, with no horizontal overflow and the chevrons evenly inset.

## Out of scope
- The funding page, stage labels and place badges (091). Website and logo text on the About page (071 and 073).

## Public docs rule
This spec is published. Describe only what is built: no future phases, no commercial plans.
