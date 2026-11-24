# 073 Company logos: pick, fetch, check, store and serve

- **Tier:** 3 (fetches third-party files and serves them from our domain). **Suggested model:** Claude Opus.
- **Depends on:** 071. **Wave:** 3.5-4.

## Goal
For every company with a `linked` website, store a small, checked copy of its best near-square icon and serve it from our own route. Visitors never contact the company's site, and no SVG or unchecked file is ever served. The decision is D72.

## Read first
- `AGENTS.md`
- `src/pipeline/websites/*`, `src/lib/http.ts`, `src/lib/robots.ts`
- `src/db/schema.ts` (`company_logos`, from migration `0005_websites`), `scripts/sql/roles.sql`

## Files changed
- `src/pipeline/websites/logo-pick.ts`, `logo-fetch.ts`, `image-probe.ts`, `logo-store.ts` and their tests (new), with `logo-testing.ts`, a test helper that builds icons in memory.
- `src/pipeline/websites/websites-step.ts` and its test: the logo work runs after a site is linked or re-checked, logos of unlinked companies are deleted, and linked sites with no logo are retried.
- `src/pipeline/wiring.ts` and `src/pipeline/run.ts`: one robots checker, wrapped in `withHostSpacing`, is shared by the page and logo fetchers, and the logo fetcher gets the same request limit as the page fetcher.
- `src/app/logos/[file]/route.ts` and its test (new).
- `src/db/queries/logos.ts` and its test (new): `getLogoUrls`, `getLogoFile`, `logoUrl`.
- `src/core/env.ts` and its test: `MAX_LOGO_BYTES`, default and maximum 65536.
- `src/cli/entities.ts`: `remove-logo --id <id> [--yes]`.
- `.github/workflows/fix-data.yml` (`remove-logo` action), `docs/deployment.md`, `docs/decisions.md` (D72).
- `fixtures/logos/*`: small synthetic icons generated for the tests. No third-party logos are in the repo.

No migration: `company_logos` and the web role's read grant already exist.

## Steps
1. **`logo-pick.ts`:**
   - Order the candidates: JSON-LD logo, `apple-touch-icon`, web manifest, `<link rel="icon">`, `/favicon.ico`.
   - Drop SVG, `data:` URLs, and hosts that are neither the company's registrable domain nor a known image CDN.
   - Keep at most 3.
2. **`logo-fetch.ts`:**
   - Robots check, then a GET with our user agent, a 10-second timeout and at most 3 redirects, each only to a permitted host.
   - Stop reading at `MAX_LOGO_BYTES`; going over that means rejected.
   - Same per-host spacing as the page fetch.
3. **`image-probe.ts`:**
   - **Type:** decide it from magic bytes only (PNG, JPEG, ICO, WebP, GIF). Reject anything else, including SVG or HTML served as an image.
   - **Dimensions:** read width and height from the headers. For ICO, take the largest entry. For a GIF, read the first frame's size.
   - **Reject:** under 32 × 32, or an aspect ratio outside 0.8-1.25.
   - Pure functions, no dependencies.
4. **`logo-store.ts`:**
   - Upsert `company_logos` with bytes, mime, width, height, sha256, source URL and fetched time.
   - When a website is demoted or rejected, or the company is merged away, delete its company's logo.
   - Never fetch for a `blocked` row.
   - Retry a linked site with no logo on one day in 30, at most 20 a run.
5. **Route `/logos/<companyId>-<hash8>.<ext>`:**
   - It reads with the web role.
   - It returns 404 unless the id, hash and extension match a stored, unblocked logo of a company that still has a website.
   - Headers: the exact `Content-Type`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cross-Origin-Resource-Policy: same-origin`, and `Cache-Control: public, max-age=31536000, immutable`.
6. **`getLogoUrls(db, companyIds)`:** returns the address for each company id that has a logo, in one query, as a plain object so it can be cached.
7. **`remove-logo` Fix data action:**
   - Takes a company id.
   - Sets `blocked` and deletes the bytes.
   - Unticked, it only previews.
8. **D72** in `docs/decisions.md`: cached copies only, no SVG, magic-byte checks, the size and shape rules, the serving headers and the removal action. Update `docs/deployment.md`.

## Tests and acceptance criteria
- **Probe:** every format, a too-small icon, a wide logo, SVG refused, HTML refused, a wrong magic number, and a truncated file.
- **Fetch:** over the cap is refused, robots disallow means no fetch, and a redirect to another site is followed only to a permitted host.
- **Route:** a correct hash returns 200 with all the headers, a wrong hash is 404, and a blocked logo is 404.
- **Step:** a newly linked site gains a logo, and a demoted site loses it.
- `pnpm check` and `pnpm build` pass. Use fakes only, with no network in tests.

## Out of scope
- Showing logos on the site's pages.
- Any image processing or resizing.
- Logos for investors.
