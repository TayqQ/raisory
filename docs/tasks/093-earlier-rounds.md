# 093 Leave out earlier rounds mentioned as history

- **Tier:** 2 (extraction prompt and eval). **Suggested model:** Claude Opus.
- **Depends on:** nothing open. **Wave:** data quality.

## Why (Taylor's review, 24 November 2026)
Bcomp showed three funding rounds in a row, all dated 24 November 2026: a €20 million EIB loan, a €37.6 million Series C and a Series B. Only the loan was new. The article mentioned the two earlier rounds as background, extraction turned each into an event, and with no date of their own they took the article's date. Gradyent's €20 million EIB loan article had the same problem with its April 2025 growth round.

## Goal
1. The extraction prompt reports only what the text announces as new. A round, acquisition or launch mentioned as the company's history is not an event. Several parts of one announcement, such as an equity round with a loan or grant, are still each their own event.
2. The extraction eval has a case for each article, and an extra event counts against the score.
3. The prompt version moves to v4, so the two items can be re-extracted with the Fix data `reextract-item` action, which removes the false rounds.

## Files changed
`src/pipeline/extract/prompt.ts` and its tests, `src/pipeline/extract/extract-item.test.ts`, `fixtures/extraction/cases.json`, the recorded eval answers, `docs/eval-results.md`, `docs/decisions.md` (D70).

## Tests and acceptance criteria
- `pnpm check` and `pnpm build` pass.
- `pnpm eval --live --model gpt-5.6-luna` passes every target, with no extra events.
- After merging, re-extracting items 1831 (Bcomp) and 1458 (Gradyent) leaves one round each: the €20 million EIB loan.

## Public docs rule
This spec is published. Describe only what is built: no future phases, no commercial plans.
