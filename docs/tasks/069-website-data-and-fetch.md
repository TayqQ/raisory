# 069 Website data model, candidate sources and polite fetcher

- **Tier:** 3 (schema and migration). **Suggested model:** Claude Opus.
- **Depends on:** 088 merged. **Wave:** 3.5-1.

## Goal
Add the Phase 3.5 tables and enums, store the UKRI organisation website, produce candidate domains for a company, and fetch a homepage politely into an in-memory page summary. No decisions yet.

## Read first
- `AGENTS.md`, `private/spec-phase3.5.md` (sections 4, 5, 6.1, 6.2, 6.7 step 1 only, 8, A50)
- `src/db/schema.ts`, `drizzle/0004_source_item_lead.sql` (latest migration), `src/core/enums.ts`
- `src/pipeline/grants/gtr-schemas.ts`, `src/pipeline/grants/` (organisation fetch), `src/lib/http.ts`, `src/lib/robots.ts` (reuse it; don't write a second robots parser)

## Files you may create or change
- `src/core/enums.ts` (`website_number`, `WEBSITE_RULES`, `WEBSITE_SOURCES` only), `src/core/env.ts`, `src/core/env.test.ts` (`MAX_WEBSITE_FETCHES_PER_RUN` only)
- `src/db/schema.ts`, `drizzle/0005_websites.sql`, `drizzle/meta/**`, `src/db/roles.sql`
- `src/pipeline/grants/` organisation fetch and its test (store `website`)
- `src/pipeline/websites/candidates.ts`, `src/pipeline/websites/fetch-page.ts`, `src/pipeline/websites/registrable-domain.ts`, plus `.test.ts` for each (new)
- `.env.example`

## Steps
1. Migration 0005, as in spec section 8: `company_websites`, `company_logos`, `grant_participants.website`. The ingest role gets the same privileges as the Phase 3 tables. The web role gets read access to `company_websites` and `company_logos` only.
2. Store `grant_participants.website`, normalised to a registrable domain. _(Changed in review: the planned one-off re-fetch of organisations fetched earlier was dropped, because A50 found no websites in GtR records. See `docs/sources.md`.)_
3. `candidates.ts`: sources 1-4 from section 5, deduplicated by registrable domain, in source order, with the source on each.
4. `fetch-page.ts`, as in 6.1 and 6.2, checking robots with `src/lib/robots.ts`. Return `{ finalDomain, title, siteName, metaDescription, text, companyNumbers[], parked, iconCandidates[], legalPageChecked, blocked }`, where `blocked` means the fetch got 401, 403 or 429 (no retry, no evasion). Icon candidates follow spec 6.2: JSON-LD logo, apple-touch-icon, same-site manifest icons, sized `rel=icon`, `/favicon.ico`, with declared sizes and types. Nothing is written to the database.
5. A50: a read-only script result in the PR description. Of 100 random fetched UKRI organisations, how many have a website?

## Tests and acceptance criteria
- `pnpm check` and `pnpm test` pass, with fakes only.
- Company number extraction is tested on at least 10 footer variants, including SC and NI numbers and a number not near a cue (ignored).
- A robots disallow means no page fetch.
- The body cap, timeout and redirect cap are each tested.
- Icon candidates are parsed from at least 6 saved `<head>` variants, including a manifest and JSON-LD.

## Out of scope
- Rules, LLM, search, the pipeline step, UI.

## Public docs rule
This spec moves to `docs/tasks/` in the PR that builds it, and the code, comments and decisions are published. Describe only what is built: no future phases, no commercial plans.
