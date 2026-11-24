# Raisory design system and page plan

Agreed with Taylor on 18 November 2026, after reviewing the three directions in `directions/`. The brand lives in `brand/`; this file covers how the product is put together. It becomes decision D66 when it merges.

## 1. Decision: one site, two list views
- **One home page structure, one company page, one phone layout.** Nothing switches per "user type".
- **The list of rounds has two views**, chosen by the visitor with a visible switch next to Sort:

  | View | Comes from | For |
  |---|---|---|
  | **List** (default) | A, Terminal | Scanning many rounds |
  | **Cards** | B, Briefing | Browsing and reading descriptions |

  A third view, Split (a list plus a company preview), was built in task 080 and removed in task 091 (section 9). An old `?view=split` link or `split` cookie shows List.
- **The choice is remembered** in the cookie `raisory_view` (`list` / `cards`, one year, `SameSite=Lax`), which the server reads so the first paint is right. `?view=` overrides it for one visit, which makes view-specific links shareable. There is no settings page.
- **Phones (under 768 px) always show the stacked list.** The switch is hidden there.
- **Views share data and parts.** Every view renders the same `FundingRow[]` from the same query, using the same primitives (section 4). A view is only an arrangement. If one view needs a field, all views get it from the same query.
- **Not done, on purpose:** separate home pages, navigation or company pages per audience. That would triple the work for every feature, and shared links would look different to different people.

## 2. Page templates
### Home (`/`)
1. **"What's happening" summary** (from B), a panel you can close, with the state remembered in the cookie `raisory_summary` (section 9).
   - A headline: £ raised, the number of rounds and the median, for a recent period, against the period of the same length before.
   - Sectors ranked by £. Each bar has a text value, and a click filters the list.
   - The three biggest rounds.
   - Its header picks the period (last 7 days, 30 days, 90 days or 12 months; 30 by default) and always states it.
2. **The filter bar** (research section 2):
   - search with the `/` shortcut;
   - the sector chip row, with themes as a second level once one sector is chosen;
   - a Stage segmented control;
   - amount presets;
   - date presets;
   - one place box (region, town, near);
   - "Confirmed only";
   - "More filters" (company size, momentum, investor, custom ranges).

   Below it, removable chips for every applied value plus "Clear all". It stays a GET form, so URLs and no-JavaScript keep working; with JavaScript it applies on change.
3. **The list**, in the chosen view, with Sort, the view switch, "Show summary" while the summary is hidden, and paging.

### Company (`/companies/[slug]`): one page combining the best of A, B and C
1. **Header** (B): monogram, name, description as a standfirst, place badge, sector and theme chips.
2. **Action row** (C): Visit website (shown with a "Website not found yet" note when there is none), Companies House (only when linked), Copy company number, Share.
3. **Key facts strip** (all three): stage, total raised, last round and its date, founded, company size, investors. Show "Not known" in muted text where a value is missing.
4. **Two columns on desktop:**
   - Main: latest round (with the proof box when confirmed), funding history timeline with amount bars, investors with their roles, sources.
   - Side, sticky (A): "Signals" (C, plain words built only from stored data), then "From official records" (Companies House facts, or an honest empty state).
5. **"Companies like this"** (same sector, then the same stage), up to five compact items.
6. **At 375 px:** one column, ordered header, key facts, latest round (all in the first screen), signals, history, investors, records, sources, similar companies.

### Other pages (trends, investors, acquisitions, themes, about, status)
These keep their structure. They move onto the new primitives and tokens in one sweep (task 081). They get no view switch.

## 3. Tokens
- **Source:** `brand/tokens.css`, already in `src/app/globals.css` (task 074).
- **Semantic utilities replace the remapped Tailwind names.** Task 074 kept `zinc-*`, `blue-*`, `amber-*` etc. remapped so pages didn't change. Task 075 adds semantic utility names. Rebuilt pages use only those:

  | Group | Utilities |
  |---|---|
  | Surfaces | `paper`, `surface`, `surface-sunk` |
  | Lines | `line`, `line-strong` |
  | Text | `ink`, `muted`, `faint` |
  | Brand | `brand`, `brand-hover`, `brand-soft`, `on-brand`, `accent`, `accent-soft`, `accent-ink` |
  | Meaning | `up`, `up-soft`, `down`, `down-soft`, `warn`, `warn-soft`, `info`, `info-soft` |
  | Data | `data-1` to `data-8` |
  | Stage | `stage-early`, `stage-seed`, `stage-venture`, `stage-late`, `stage-other` |

  The old names stay until task 081 removes the last user, then they are deleted.
- **Type:**
  - Inter Tight 600 for page titles, section headings and big figures.
  - Inter 400/500/600 for everything else.
  - The scale is 12, 13, 15 (body), 17, 20, 24, 30, 38, 48 px.
  - Tabular figures on every number that can line up.
- **Space:** a 4 px base. Components use 4, 8, 12, 16 and 24; page sections use 32, 48 and 64.
- **Radius:** 6 for controls and chips, 10 for cards and panels, 14 for sheets and large tiles, pill for chips that are filters.
- **Depth:** flat by default with hairline `line` borders. `shadow-1` only for sticky headers; `shadow-2` only for popovers, sheets and menus.
- **Motion:** 120 ms for hover and press, 200 ms for sheets and popovers, `ease-out`. No motion when `prefers-reduced-motion` is set.
- **Breakpoints:** `sm` 640, `md` 768 (phone to tablet; the list stops stacking), `lg` 1100, `xl` 1280.

## 4. Components (`src/components/ui/`)
Each component is small and has no data access: it takes values, renders them, and has a unit test. Pages and views compose them.

| Component | What it shows | Notes |
|---|---|---|
| `Monogram` | 1-2 letters on a tint picked from the name | Sizes 24, 28, 40, 56. `aria-hidden` (the name is always next to it) |
| `CompanyMark` | The company's logo on a light tile, or its `Monogram` when it has no logo | Same sizes as `Monogram` (24, 28, 40, 56). See below |
| `Amount` | GBP first, original currency small beneath when it differs | "Undisclosed" in muted text when null. Sizes `sm` (list) and `lg` (company) |
| `StageChip` | Stage text on a filled label in the stage's soft colour | Never colour alone. Text on every fill is at least 4.5:1 in both themes (`src/lib/stage.test.ts`). Normalised label (`Series F` shows "Series F" but uses the late-stage colour) |
| `ConfirmedMark` | Tick icon plus "Confirmed" | Its title is the confirmation text. It replaces the current `confirmed-marker` look and keeps its tests |
| `PlaceBadge` | Country flag (`CountryFlag`, a static SVG from `public/flags`, 20 × 15 px, 24 × 18 px in the company header) plus city, or the country's name when the city is not known | The flag's alt text is the country name; next to the name the flag is decorative; a code with no file shows as text; "Place not known" in muted text |
| `SectorLabel` | The main sector | "Sector pending" in muted text when null |
| `RelativeDate` | "Yesterday", "4 days ago", then a date after 14 days | Exact date in `title` and `<time dateTime>` |
| `NewMark` | A brass dot plus "New" | Rounds announced within 2 days |
| `Chip` / `FilterChip` | Static label / removable applied filter | FilterChip is a link that removes the value (works without JavaScript) |
| `SegmentedControl` | Stage, view switch, £/rounds toggle | Radio-group semantics, arrow keys |
| `Button` | `primary`, `secondary`, `ghost`; sizes `sm` and `md` | At most one primary per view |
| `Popover`, `Sheet` | Filter popovers on desktop, bottom sheet on phones | Focus trap, Escape closes, returns focus |
| `Stat` | Label plus figure plus sub-line | Key facts strip and the summary headline |
| `RankedBars` | Ranked bars with a text value per bar | Used by the summary and trends. Clicking a bar filters the list |
| `EmptyState` | Honest "not known yet" panels | For example "No Companies House match yet" |

Views (`src/components/rounds/`):
- `RoundList` (table rows on desktop, stacked on phones);
- `RoundCards`;
- `ViewSwitch`.

All of them take `rows: FundingRow[]` plus selection state, nothing else.

### Company marks
`CompanyMark` replaces `Monogram` wherever a company is named: round lists and cards, the biggest rounds in the summary, similar companies and the company page header.

- **Logo:** the tile is white in both themes, so a dark logo stays visible in dark mode. It has a hairline `border-line` border (the token follows the theme), the monogram's radius and a small padding (3 px at 24 and 28, 4 px at 40, 6 px at 56). The image fills the padded tile with `object-fit: contain` and carries explicit `width` and `height`, so nothing shifts as it loads.
- **Alt text:** empty. The company's name is always beside the mark.
- **Fallback:** with no logo the `Monogram` shows, unchanged.
- **Source:** the `logoUrl` is always a `/logos/...` address from `getLogoUrls` (D72), fetched once per list. A company's own image is never linked to directly.
- **Server only:** it renders on the server and adds no client JavaScript.
- **Website link:** the company page header shows the website's bare domain as a link only while the website is verified (`companies.website_domain`, D64). A candidate or rejected website shows nothing.

## 5. Data each view needs (task 076)
`FundingRow` gains `companyDescription` (one line, from `companies.description`), `mainSector` (a sector key, or null, using the order in research section 5), and `websiteDomain` (null for now). The stage colour comes from `stageBucket(roundType)` in `src/lib/stage.ts` (task 075) at render time, so it is not a row field.

A new query, `getFundingSummary(filters)`, returns:
- total GBP, count and median for the window, and the same for the previous window;
- sectors ranked by GBP and count;
- the three biggest rounds.

It is computed in SQL from the same filtered set as the list, with the summary's own dates (section 9).

## 6. Accessibility and quality bar
- Text contrast at least 4.5:1, chart and UI marks at least 3:1, in both themes. The contrast test from 074 extends to every new token pair a component uses.
- **Keyboard:**
  - `/` focuses search;
  - in List, j/k or the arrow keys move between rows;
  - Enter opens the selected row;
  - Escape closes sheets and popovers;
  - focus is always visible.
- **The definition of done for every page task:**
  - `pnpm check` and `pnpm build` pass;
  - screenshots at 375 and 1280 px in light and dark (`pnpm screenshots`, extended per task);
  - no horizontal page scroll at 375 px;
  - the first-screen rule for the company page holds;
  - empty and missing-data states are shown with real data.

## 7. Build order
| Wave | Tasks | Runs in parallel? |
|---|---|---|
| 1 | 075 primitives and semantic tokens; 076 row fields and summary queries | Yes (different files) |
| 2 | 077 company page; 078 filter bar | Yes |
| 3 | 079 home summary, quick views, List and Cards, view switch | After 076 and 078 |
| 4 | 080 Split view (removed in 091) | After 079 |
| 5 | 081 sweep the other pages onto the system, then delete the old remapped names | After 075, best after 079 |

Split shipped last on purpose: a view is only an arrangement, so it can be dropped cheaply. Task 091 dropped it.

## 8. v2: the app shell and the Harbour+ palette (19 November 2026)
After seeing v1 live, Taylor asked for three changes. This section overrides anything above that conflicts with it.

1. **Palette.** Navy and orange "Harbour+" replaces green and brass (`brand/brand.md`, `brand/tokens.css`). Dark mode uses layered surfaces (paper < surface < raised < overlay), so it is no longer one flat dark plane. In light mode, orange marks what to act on or notice.
2. **The site is an app that uses the whole window,** like Linear, Discord or Netflix, not a page centred in 1280 px:
   - **Sidebar** (240 px, `--nav-bg`):
     - the logo;
     - primary nav: Funding, Companies, Investors, Sectors, Trends, Acquisitions;
     - a lower group: Status, About;
     - the theme toggle at the foot.

     At 1024-1279 px it collapses to a 64 px icon rail, with tooltips and the same order. Under 768 px it becomes a bottom tab bar with Funding, Companies, Investors, Trends and More (More opens a sheet with the rest).
   - **Top bar,** across the content area: global search (`/` and ⌘K focus it; it searches companies and investors and lands on the funding list with `q`), then on the right the primary orange action (a placeholder link).
   - **Content area:** no `max-width` container. Panels and lists fill the width, with sensible minimums. Long prose (About) keeps a readable measure inside its panel.
   - **List** is the default view at every width (Split, once the desktop default, was removed in task 091). The visitor's choice still wins.
3. **No page title and description blocks.** Remove the large H1 and standfirst at the top of every page ("Who just raised, how much, and from whom" and the others):
   - The sidebar's active item says where you are. Each page still has one H1 for accessibility, either visually hidden or the entity's own name on detail pages (the company, investor or theme name stays visible as the page header).
   - Context such as "From the 16 most recent rounds" lives in small captions beside the data it describes.

The prototype is `brand/palette-v2.html` (palette D, "Home" and "Company" pages). Tasks: 082 (tokens and logo), 083 (app shell), 084 (remove page headers, full-width pages).

## 9. Funding page refinements (24 November 2026)
After reviewing the live site, Taylor asked for a simpler funding page (task 091). This section overrides anything above that conflicts with it.

1. **Two views.** Split and its company preview are gone, with the `/api/company-preview` route and its query. List and Cards stay, and List keeps j/k.
2. **No quick-view tabs.** The tabs above the list were filters in another form, so they are gone with their counts. "Show summary" sits next to Sort and the view switch while the summary is hidden.
3. **Filled stage labels.** The whole label takes its stage's soft fill (`--stage-*-soft`) with stage-coloured text (`--stage-*-ink`), at least 4.5:1 in light and dark. The solid stage ramp stays for bars and other marks.
4. **Place.** Flags are 20 px wide in rows and cards and 24 px in the company header. With no town, the country's name sits next to the flag.
5. **The summary is a panel.** A bordered card with a header (title, period, close button "Hide summary") and a footer (what the changes compare with, "Keep hidden by default"). Open or hidden is still kept in `raisory_summary`.
6. **The summary covers a recent period:** last 7 days, 30 days (the default), 90 days or 12 months. The header's control is a row of links to `?summary=7d|30d|90d|12m`, so it works without JavaScript and can be shared. With JavaScript the choice is also kept for the browser session in `raisory_summary_period`, because filter, sort and page links do not carry `?summary=`. The comparison is the period of the same length just before (`previousWindow`).
7. **In step with the list.** The summary uses the list's other filters. When the list has its own dates, the summary covers their overlap with the period and says so in a short line; when they do not overlap, it says there is nothing to summarise.

