# 071 Websites daily step and review actions

- **Tier:** 2. **Suggested model:** Claude Sonnet.
- **Depends on:** 070. **Wave:** 3.5-3 (in parallel with 072).

## Goal
Run website finding daily within a time limit, and let the maintainer review website candidates from GitHub.

## Read first
- `AGENTS.md`, `private/spec-phase3.5.md` (sections 4, 5, 9, 11, A53)
- `src/pipeline/registry/registry-step.ts` (the time-limit pattern from 068 and 085), `src/pipeline/run.ts`, `src/pipeline/wiring.ts`, `src/cli/pipeline.ts`
- `.github/workflows/daily.yml`, `.github/workflows/fix-data.yml`

## Files you may create or change
- `src/pipeline/websites/websites-step.ts` and its test (new)
- `src/pipeline/run.ts`, `src/pipeline/wiring.ts`, `src/cli/pipeline.ts` (the `websites` command only)
- `src/core/env.ts`, `src/core/env.test.ts` (`MAX_WEBSITE_MINUTES_PER_RUN`)
- `.env.example`, `.github/workflows/daily.yml`, `.github/workflows/fix-data.yml`, `docs/deployment.md`
- `src/app/about/**` (the short "How we find websites and logos" note, with the removal contact)

## Steps
1. **Queue,** as in section 4: news companies first, then grant-only companies with a UKRI website. Use a fingerprint and a 180-day re-check, as `registry_searches` does.
2. **Limits:** a time limit and a fetch cap, stopping only between companies. Report stats as JSON for the step summary:
   - checked;
   - linked, candidate and rejected by rule;
   - blocked (A53);
   - fetches.
3. **`daily.yml`:** add the step after grants and before the registry step, with `timeout-minutes: 12`. The job limit rises from 93 to 105.
4. **`fix-data.yml`:** add `website-list`, `website-approve` and `website-reject`. Follow the registry actions exactly: ids are checked as numbers separated by spaces, and an unticked confirm only previews.
5. **Search:** none in this phase (spec 12.1). The step summary says "search off".

## Tests and acceptance criteria
- `pnpm check` and `pnpm test` pass.
- The time limit stops between companies, and a fake-clock test shows it.
- A blocked site is `rejected` with rule X1, is counted as blocked, and is retried at the re-check.

## Out of scope
- Companies House linking from numbers (072), logos (073), UI (090).

## Public docs rule
This spec moves to `docs/tasks/` in the PR that builds it, and the code, comments and decisions are published. Describe only what is built: no future phases, no commercial plans.
