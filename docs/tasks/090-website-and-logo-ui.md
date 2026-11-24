# 090 Website link and logos in the UI

- **Tier:** 1. **Suggested model:** Claude Sonnet.
- **Depends on:** 073.

## Goal
Show each company's logo wherever its monogram appeared, and its verified website on the company page. With no logo, the monogram stays.

## Read first
- `AGENTS.md`, `docs/design/design-system.md`
- `src/components/ui/monogram.tsx` and every place it was used
- `src/db/queries/logos.ts` (073, D72), the company read models in `src/db/queries/**`
- `src/components/company/company-header.tsx`

## Files changed
- `src/components/ui/company-mark.tsx` (new) and its tests in `display.test.tsx`: `CompanyMark`, which wraps `Monogram`.
- `src/components/rounds/round-list.tsx`, `round-cards.tsx`, `round-views.tsx`, `src/components/home/funding-summary.tsx`, `src/components/company/similar-companies.tsx`: use `CompanyMark` and take a `logoUrls` object.
- `src/components/company/company-header.tsx`: `CompanyMark` and the website link.
- `src/core/read-models.ts`, `src/db/queries/funding.ts`, `src/db/queries/companies.ts`: `companyId` on `FundingRow` and `SimilarCompany`, so a page can ask for logos in one batch.
- `src/lib/cached.ts`: `cachedLogoUrls`.
- `src/app/page.tsx`, `src/app/themes/[slug]/page.tsx`, `src/app/companies/[slug]/page.tsx`: one logo lookup per page.
- `src/db/queries/logo-rows.test.ts` (new) and the component tests.
- `docs/design/design-system.md`: a short section on company marks.

## What it does
1. **`CompanyMark`:**
   - With a `logoUrl`, it shows an `<img>` on a white rounded tile with a hairline `line` border, in both themes. The image uses `object-fit: contain`, small padding, and explicit `width` and `height`, so there's no layout shift.
   - It uses `alt=""`, because the company name is always beside it.
   - Without one it shows the monogram, unchanged.
   - It is a server component, so it adds no client JavaScript.
2. **Logo addresses** come from `getLogoUrls` in one query per page, through `cachedLogoUrls`. Companies with no servable logo (none stored, blocked, or no website) are left out, so they keep the monogram.
3. **Company header:** the website's bare domain is a link (`rel="noopener nofollow"`, new tab) when `companies.website_domain` is set. That column follows the one `linked` website row (D64), so a candidate or rejected website shows nothing.
4. **Never:** no hot-linking and no third-party image hosts. Only `/logos/...` addresses from 073.

## Tests and acceptance criteria
- `CompanyMark`: a logo, no logo, and the light tile and theme-aware border classes.
- Queries: a page of rows gets an address for a company with a logo and none for one without or one blocked.
- The header shows the link only with a domain.
- `pnpm check` and `pnpm build` pass. The first-load JS for `/` doesn't grow.

## Out of scope
- Fetching or storing logos (073).
