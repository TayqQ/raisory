# 091 Funding page refinements

- **Tier:** 2 (UI, one small query change). **Suggested model:** Claude Opus.
- **Depends on:** 089 (merged). **Wave:** UX polish.

## Why (Taylor's review, 24 November 2026)
The funding page carries features that don't earn their place. The Split view feels incomplete next to List and Cards, and the tabs above the list look separate from the filters when they are filters. Some things are hard to read at a glance: stage is a small coloured dot, flags are small, and a company with a country but no town shows a flag alone. The summary looks like part of the page rather than a panel you can close, and it covers every round ever recorded rather than a recent period.

## Goal
1. **Remove the Split view.** List and Cards stay. Delete the Split components, the company-preview route and query, and anything else used only by Split, including its tests. A `view=split` URL or cookie falls back to List with no error. Keep the List's j/k keys if they work without Split; remove them if they only served it.
2. **Stage labels are filled.** The whole label takes the stage colour as its background, with no dot. Text meets WCAG AA (4.5:1) on every stage colour in light and dark themes; add a test that checks the contrast. Use tinted or soft fills if the solid ramp fails. Stages stay easy to tell apart.
3. **Place:** flags are a little larger in the list, cards and company header (about 20 px wide, up from about 16). When the town is not known, show the country's name next to the flag ("Switzerland"), not the flag alone. "Place not known" stays for neither.
4. **Remove the quick-view tabs** above the list, and their count queries if nothing else uses them. The "Show summary" control moves somewhere sensible, near the view switch or the filter bar.
5. **Summary panel:**
   - **Looks like a panel.** It is clearly a separate card you can close: a raised surface or border, a header with a title, and a visible close button labelled "Hide summary". It still remembers open or hidden in its cookie.
   - **Covers a recent period.** A segmented control in its header picks the period: last 7 days, 30 days, 90 days or 12 months. The default is 30 days. The choice is kept in the URL (`summary=7d|30d|90d|12m`) so it can be shared. The comparison with the previous period of the same length uses the existing `previousWindow`.
   - **Stays in step with the list.** The summary keeps the list's other filters (sector, stage, place and so on). If the list has its own date range, the summary uses the overlap with the chosen period and says so in a short line. The header always states the period ("Last 30 days").

## Read first
- `AGENTS.md`, `docs/design/design-system.md` if present, `docs/decisions.md` (search for Split, D66, view), `src/app/page.tsx`
- `src/components/home/*`, `src/components/rounds/*`, `src/components/ui/stage-chip.tsx`, `place-badge.tsx`, `country-flag.tsx`, `segmented-control.tsx`, `src/lib/stage.ts`, `src/lib/view-preference.ts`, `src/lib/cached.ts`
- `src/db/queries/summary.ts`

## Files you may create or change
Anything under `src/app/page.tsx`, `src/app/api/company-preview/**` (delete), `src/components/home/**`, `src/components/rounds/**`, `src/components/ui/{stage-chip,place-badge,country-flag}.tsx` and their tests, `src/lib/{stage,view-preference,cached,country-names}.ts` and their tests, `src/db/queries/summary.ts` and its tests, `src/app/globals.css` (stage tokens only), `scripts/screenshots.ts` (drop Split shots), and docs that describe the Split view or the tabs (`docs/`, `README.md`).

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass.
- No reference to Split remains in `src/` except the fallback that maps old `view=split` to List.
- A stage contrast test covers every stage bucket in both themes.
- The summary's period control works without JavaScript. It is a set of links, or a form that submits on change but works with a plain submit.
- Checked in the browser at 375 px and 1280 px, light and dark, with no horizontal overflow.

## Out of scope
- Company logos and website UI (090). Themes, investors and About pages (092).

## Public docs rule
This spec is published. Describe only what is built: no future phases, no commercial plans.
