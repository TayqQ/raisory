# 089 Country flags instead of two-letter codes

- **Tier:** 1 (display only). **Suggested model:** Claude Sonnet.
- **Depends on:** 086 (merged). **Wave:** UX polish.

## Why (Taylor's review, 23 November 2026)
Places show a two-letter country code in a grey box ("GB London"). A small flag reads faster, and it's how people expect to see a country.

## Goal
Everywhere the site shows a company's country as a code, it shows a small flag instead, with the country's name available to screen readers and on hover. No JavaScript is added for flags.

## Read first
- `AGENTS.md`
- `docs/design/design-system.md` (tokens, sizes, accessibility rules)
- `src/components/ui/place-badge.tsx` and its test
- Every other place a country code is shown as text. Start with `grep -rn "countryCode" src/components src/app`, then check `company-location.tsx`, `filters/filter-bar.tsx`, `home/quick-views.tsx`, `rounds/round-cards.tsx`, `rounds/round-list.tsx`, `rounds/round-preview.tsx`, `company/company-header.tsx`, `company/official-records.tsx` and `company/similar-companies.tsx`.
- `package.json`, `pnpm-workspace.yaml` (supply-chain settings), `LICENSE`

## Files you may create or change
- `src/components/ui/country-flag.tsx` and its test (new)
- `src/components/ui/place-badge.tsx` and its test
- The components listed above, only to swap the code for the flag, plus their tests
- `public/flags/*.svg` (new), `scripts/build-flags.ts` (new), `public/flags/LICENSE` (new)
- `package.json` and `pnpm-lock.yaml` (one dev dependency, if you use one)
- `docs/design/design-system.md` (one line under place badges)
- Do **not** edit `docs/tasks/README.md`.

## Steps
1. **Flag files.**
   - Add static SVG flags at `public/flags/<code>.svg`, lower-case ISO 3166-1 alpha-2, for every country, plus `gb` (the UK code we store is `GB`).
   - Source them from a well-known, MIT- or similarly-licensed flag set: `country-flag-icons` 3:2 SVGs or `flag-icons` 4:3. Pin an exact version that is at least two weeks old.
   - Generate them with `scripts/build-flags.ts` (a dev dependency only) and commit the output, so the site has no runtime dependency.
   - Keep the licence in `public/flags/LICENSE`.
   - Keep the total small; minify if the source isn't.
2. **`CountryFlag`** (server-safe, no hooks):
   - Renders `<img src="/flags/xx.svg" width height alt="United Kingdom" title="United Kingdom">`.
   - The name comes from `Intl.DisplayNames(["en-GB"], { type: "region" })`. Fall back to the code if the name is unknown.
   - **Size:** about 16 × 12 px in rows and chips; allow a slightly larger size in the company header.
   - **Look:** a 2 px radius and a hairline inner border using the `line` token, so white flags stay visible in light mode and dark flags in dark mode. `object-fit: cover`.
   - **Codes with no file** (bad data, or `EU` and `XK` if no file exists) fall back to today's text code.
   - `loading="lazy"` and `decoding="async"`.
3. **`PlaceBadge`:** show the flag, then the town. The accessible text must still give the country, for example "United Kingdom, London". The flag replaces the code; don't show both. With no country, show the town only, as today. With neither, keep "Place not known".
4. **Other uses:** swap the code for the flag wherever a country is shown as a code:
   - list rows, cards, the split preview and similar companies;
   - the company header and official records;
   - the place filter options, where the flag sits beside the country name.

   Where a full country name is already shown as text, add the flag before it only if it helps scanning; don't duplicate.
5. **Don't change** data, filters, URLs or sort order.

## Tests and acceptance criteria
- `CountryFlag`:
  - GB gives `/flags/gb.svg` with alt "United Kingdom";
  - lower-case input works;
  - an unknown code falls back to the text code;
  - null renders nothing.
- `PlaceBadge`: the four cases (both, country only, town only, neither), with accessible text.
- Every country code present in the live data has a file. Run a script or test that checks the codes in `src/core/enums.ts` or the seed against `public/flags`, and document how.
- **In the browser,** at 1440 and 375 px, light and dark, with real data:
  - check the list, cards, split view, company page and place filter;
  - flags are crisp, aligned with the text baseline and don't shift row height;
  - nothing scrolls sideways.
- `pnpm check` and `pnpm build` pass. The first-load JS for `/` doesn't grow.

## Out of scope
- Company logos (a later task).
- Changing how countries are detected or stored.
- Any commit, push or PR.
