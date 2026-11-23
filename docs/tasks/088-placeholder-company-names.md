# 088 Never publish a placeholder company name; read the article opening; fix names by hand

- **Tier:** 2 (changes what the model reads and what gets published; one migration). **Suggested model:** Claude Opus.
- **Depends on:** 087 (merged). **Wave:** fix.

## Why (found 23 November 2026)
- BusinessCloud's story "Monzo alumni raise £1.8m for startup as Burbidge invests" (source item 1635) became a company called **"startup"** (company 2391, slug `startup`).
- The feed summary we send to the model never names the company ("The startup's team previously built machine-learning scam models at Monzo…"). The full article in the feed's `content:encoded` opens with the name, **Acorda**.
- So the model took the word from the headline. A stronger model would not have helped, because the name wasn't in its input.
- There is also no way to correct a company name by hand, or to re-run one article.

## Goal
- When a feed carries the article body, the model also reads its opening.
- A placeholder such as "startup" is never published as a company name. Such a result gets one retry on a stronger model, and if that still fails, the round is held back and counted.
- Two small tools fix mistakes:
  - rename a company;
  - re-extract one source item.

  The maintainer can run both from GitHub.

## Read first
- `AGENTS.md`
- `src/pipeline/collect/parse-feed.ts` (`SUMMARY_MAX_CHARS`, `summarySource`), `src/pipeline/collect/rss.ts`
- `src/pipeline/extract/extract-item.ts`, `src/pipeline/extract/prompt*` (`EXTRACTION_PROMPT_VERSION`), `src/pipeline/extract/pricing.ts`, and the budget guard
- `src/pipeline/run.ts` (`extractStep`, `reextractStep`, `listItemsForReextract`, `resolveStep`), `src/pipeline/resolve/*`
- `src/cli/pipeline.ts`, `src/cli/entities.ts`, `src/pipeline/resolve/merge-entities.ts` (how aliases and slugs are handled)
- `src/db/schema.ts` (`source_item_texts`, `companies`, `company_aliases`, `extractions`), `drizzle/`, `src/db/roles.sql`
- `docs/decisions.md` (D-entries on attribution, feed summaries and extraction), `docs/sources.md`
- `.github/workflows/ingest.yml` (summary rows), `.public-exclude`

## Files you may create or change
- `src/pipeline/collect/*` and tests
- `src/pipeline/extract/*` and tests, `fixtures/extraction/*` only if a test needs a new case
- `src/pipeline/run.ts` and its test, `src/pipeline/resolve/*` and tests
- `src/pipeline/names/placeholder.ts` and test (new), or a better place you find
- `src/cli/pipeline.ts`, `src/cli/entities.ts`, `src/pipeline/resolve/merge-entities.ts` or a new `rename-entities.ts`, and their tests
- `src/db/schema.ts`, one new migration in `drizzle/`, and `src/db/roles.sql` only if grants need it
- `src/core/env.ts` and its test (one new variable)
- `.github/workflows/ingest.yml` (summary row), `.github/workflows/fix-data.yml` (new), `.public-exclude` (add `fix-data.yml`)
- `docs/decisions.md` (add D69), `docs/sources.md`, `docs/deployment.md`
- Do **not** edit `docs/tasks/README.md`.

## Steps
1. **Article opening.**
   - In `parse-feed.ts`, when an item has a body (`content:encoded`, or Atom `content` that is longer than the summary), keep a `lead`: the first sentences of the body as plain text, up to 150 words and 1,000 characters, cut at a sentence end where one exists. Strip HTML, captions and "The post … appeared first on …" lines.
   - Store it in a new nullable column `source_item_texts.lead`. Write one migration. The web role must not be able to read it; check `roles.sql`.
   - **Backfill:** when the collector sees an item it already has and its stored lead is null, fill the lead. This lets recent items, including item 1635, gain a lead on the next run.
2. **Extraction input.**
   - Send the model the title, the summary, and the lead when present, clearly labelled ("Article opening:").
   - Tell the model to name the company from the opening when the summary only says "a startup".
   - Bump the prompt version (v3), keep v2's schema, and update anything that pins v2.
   - **Cost:** about 200 extra input tokens per item. Note the estimate in D69.
3. **Placeholder guard.**
   - `isPlaceholderCompanyName(name)` returns true for generic descriptions rather than names. For example:
     - "startup", "start-up", "scale-up", "the company", "a London startup";
     - "fintech", "healthtech" and similar sector words used alone;
     - "unnamed", "stealth startup", "platform";
     - an article (a/an/the) followed only by generic words.
   - It must not flag real names that contain such words ("Startup Genome", "Fintech Farm", "Platform.sh"). A short, curated list plus a pattern is enough. Unit-test 20 or more cases each way.
4. **Retry, then hold.**
   - If any event's company name is a placeholder, re-run that item once on `EXTRACTION_RETRY_MODEL` (new variable, default `gpt-5.6-terra`, must be in the pricing table), through the same budget guard.
   - Keep the better result as the current extraction. Record both calls in `llm_usage`.
   - If the name is still a placeholder, resolve must **not** create a company or event for that event. It logs `held: placeholder company name (item N)` and counts it in a new stat `eventsHeldPlaceholder`, shown as a row in the `ingest.yml` summary.
   - The same guard applies in `reextract` and to grants, if grants can produce such names.
5. **Re-extract one item:** `pnpm ingest reextract --item <sourceItemId>`.
   - Runs the current prompt (with retry) on that one item.
   - Supersedes its old extraction.
   - Re-runs resolve for it, so the derived event moves to the right company.
   - It must be idempotent.
   - If the old company ends up with no events, sources or grants, leave it as is. Step 6 decides what to do with it.
6. **Rename a company:** `pnpm entities rename --type company --id <id> --name "<new name>" [--yes]`.
   - Without `--yes`, it previews the change.
   - It updates the name, `normalised_name` and slug (a unique slug, made the same way as new ones), then re-runs the derived steps that read names (themes and stats are fine as they are; search and sectors only if they cache names).
   - It does **not** add the old name as an alias when the old name is a placeholder; otherwise it adds it.
   - It is recorded in `entity_merges` or a similar audit row, if a suitable one exists.
   - Investors: support `--type investor` only if it costs little.
7. **`fix-data.yml`**, a manual workflow that runs only in the private repo (`if: github.repository == 'TayqQ/raisory-private'`).
   - `workflow_dispatch` inputs:
     - `action` (`rename-company`, `reextract-item`, `merge-company`);
     - `id`;
     - `name`;
     - `keep_id`;
     - `confirm` (boolean; without it the run is a preview).
   - Uses the existing `DATABASE_URL`, `OPENAI_API_KEY` and variables in the private repo.
   - Writes a short step summary.
   - Add it to `.public-exclude`.
8. **D69** in `docs/decisions.md`:
   - the article opening is read for extraction only, never displayed, and the web role can't read it;
   - which active sources provide a body (check each feed and list them in `docs/sources.md`);
   - the placeholder guard, the retry model and the hold;
   - the cost.
   - `docs/deployment.md`: the new variable and the fix-data workflow.

## Tests and acceptance criteria
- Fixture test with a BusinessCloud-style item: the summary has no name and `content:encoded` opens with "Acorda, founded by former Monzo…". Check that the lead is kept, cut correctly, free of boilerplate, and part of the model input.
- Placeholder guard: cases both ways.
- Retry:
  - a fake model returns "startup", then the retry model returns "Acorda": the company is Acorda and both calls are recorded;
  - both return "startup": nothing is created and `eventsHeldPlaceholder` is 1.
- `reextract --item` moves the event to the new company and is idempotent.
- `rename`: the preview changes nothing; with `--yes` the slug is unique and no placeholder alias is added.
- Backfill: an existing item with no lead gains one when it's seen again, and nothing else changes.
- `pnpm check` and `pnpm build` pass. Use fakes only, with no network in tests. The migration applies twice cleanly (`pnpm db:migrate` re-run is a no-op).

## Out of scope
- Fetching article pages from the web. Use only what the feed carries.
- Showing the lead anywhere on the site.
- Any commit, push or PR.
