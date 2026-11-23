# Decisions

Each entry records the decision, the alternatives considered, and why. New decisions are appended. Superseded entries are marked, not deleted.

## D1. One TypeScript package for the web app and the pipeline
- **Chosen:** a single Next.js project. The pipeline lives in `src/pipeline` and runs as a CLI. Lint rules enforce the boundaries between folders.
- **Alternatives:** a pnpm monorepo (`apps/web`, `packages/pipeline`); a separate Python pipeline.
- **Why:** one install, one tsconfig and one test runner make each task cheaper for a fresh agent. Shared types need no publishing step. Import-restriction lint rules give most of the isolation a monorepo would. We can split later if the pipeline outgrows this.

## D2. Drizzle ORM with drizzle-kit migrations
- **Alternatives:** Prisma; Kysely plus a separate migration tool.
- **Why:** schema-as-TypeScript with SQL-like queries. It has first-class `vector` column support and no native engine binary. It works with the Neon HTTP driver, node-postgres and PGlite through one API. Prisma needs raw SQL for pgvector and is heavier in serverless.

## D3. Neon Postgres with pgvector and pg_trgm
- **Alternatives:** Supabase; SQLite/Turso.
- **Why:** real Postgres with a free tier that suspends when idle. `pg_trgm` gives fuzzy name matching inside the database, and pgvector supports theme clustering in Phase 2. Supabase is also good but bundles auth and storage we don't need yet. SQLite would make vectors and concurrent writes harder.

## D4. Scheduled ingestion on GitHub Actions cron
- **Alternatives:** Vercel Cron; Trigger.dev or Inngest; a small VPS.
- **Why:** free for public repos, with long run times. Secrets stay out of the web host, and logs are public and inspectable. Vercel Hobby cron is limited and runs inside short function timeouts. A hosted job service adds an account and another free tier to watch.
- **Trade-off:** cron start times are best-effort, and GitHub disables schedules after 60 days of repo inactivity (A13). The schedule is hourly because EU-Startups only keeps about a day of items (A3). That still fits Neon's free compute allowance.

## D5. The web app cannot trigger ingestion or spend money
- **Chosen:** no HTTP route starts any pipeline step. The web app uses a read-only Postgres role that cannot read `source_item_texts`, and its environment has no LLM key.
- **Why:** this is least privilege. A previous design let page visits trigger paid LLM calls. Making that impossible by construction is stronger than guarding it with checks.

## D6. OpenAI behind our own `LlmClient` port, paid with prepaid credits
- **Alternatives:** Google Gemini (free tier, postpaid billing with alert-only budgets); Anthropic Haiku (prepaid, but several times the price per token and no embeddings); the Vercel AI SDK as a provider abstraction.
- **Why:** prepaid credits with auto-recharge off give a provider-enforced ceiling on top of our own cap. OpenAI's cheap models support strict JSON-schema output, and the same account covers embeddings. A small interface that we own (`complete({system, user, schema})`) keeps the provider swappable in one adapter file and easy to fake in tests, without coupling to a fast-moving SDK abstraction.
- **Model choice:** we don't fix a model here. The eval (Task 014) picks the cheapest model that meets the accuracy targets.

## D7. Extract from headline and feed summary only
- **Alternatives:** fetch and parse each article page.
- **Why:** this avoids scraping and publisher-terms risk, keeps tokens low, and needs no HTML parsing per site. The cost is lower recall for investor lists and locations. That limitation is documented in the README.

## D8. The LLM finds facts; code computes values
- **Chosen:** the LLM returns `amountText` verbatim ("€3.5M"), and `src/lib/money.ts` parses it. Domains are kept only if they appear in the source text. Tags are normalised in code.
- **Why:** models are unreliable at unit scaling and invent plausible domains. Deterministic parsing is unit-tested and can be re-run without paying again.

## D9. Process each item once; re-extraction is explicit
- **Chosen:** extractions are unique on (item, prompt version, model). Pipeline steps select only pending or unresolved rows. Re-extraction is a separate command with a dry-run cost estimate and a required `--yes`.
- **Why:** a previous design reprocessed every row with paid calls on each server start. Idempotent steps make reruns free and safe.

## D10. Spend cap in three layers that fail closed
- **Chosen:**
  1. An app-level monthly guard checked before every call, using worst-case cost. Unknown model prices are refused.
  2. A per-run item limit.
  3. Provider prepaid credits.
- **Why:** each layer covers a different failure: a logic bug, a runaway loop, a leaked key. The default cap is £3. Measured volume puts normal spend at about £0.10-£0.80 a month, so the cap is headroom rather than the expected bill. Ingestion pauses if spend reaches it, and the status page shows that.

## D11. Deterministic entity resolution plus a review queue (no embeddings in Phase 1)
- **Alternatives:** LLM-judged matching; embedding similarity; hard-coded fixes.
- **Why:** rules are explainable, testable and free. Domain, exact normalised name, and fuzzy name confirmed by a matching event cover the common duplicate patterns. Ambiguous cases go to `merge_candidates` for a person to decide, rather than being guessed. Embedding columns exist in the schema so Phase 2 can add semantic signals without a migration. There is no fallback "embedding" made from a non-deterministic hash.

## D12. Events are derived from extractions
- **Chosen:** canonical event fields are recomputed from every linked extraction each time something changes, using majority vote, then source priority, then the earliest item.
- **Why:** the result doesn't depend on arrival order, new evidence can correct old values, and re-extraction can rebuild events without guesswork.

## D13. Class-table inheritance for events
- **Alternatives:** one wide table with nullable columns; a JSONB details column; fully separate tables.
- **Why:** a shared `events` table gives one timeline query and one `event_sources` link table. Typed detail tables keep constraints and indexes on amounts and round types. JSONB would make Phase 2 aggregations slower and unchecked.

## D14. Free-form tags now, themes later
- **Alternatives:** a fixed sector list.
- **Why:** a fixed list of 7 sectors could not surface new themes. Phase 1 stores 0-5 free-form tags per company. Phase 2 clusters tag embeddings into themes in new tables, leaving raw tags untouched.

## D15. Keep all history
- **Why:** trends need long baselines. Storage grows by about 10 MB/month, which fits the free tier for years. If space ever runs out, we archive rather than delete.

## D16. Money as integer minor units: original, USD and GBP
- **Chosen:** store the original amount and currency, plus USD and GBP converted at the ECB reference rate for the announcement date (via Frankfurter). The UI shows GBP first, with the original amount alongside.
- **Why:** integers avoid floating-point errors. Most funding news and most databases use USD, so storing USD keeps numbers comparable with sources. GBP suits the UK focus. Storing both converted values keeps queries simple (sorting and filtering without joining rates).

## D17. Vitest and PGlite for tests; no network
- **Alternatives:** a Docker Postgres for every test run; mocking the ORM.
- **Why:** PGlite is real Postgres in-process, with `vector` and `pg_trgm`, so tests run anywhere, including several git worktrees at once, with no setup. A CI job still applies migrations to a real Postgres container to catch differences. Making `fetch` throw in tests keeps them deterministic and free.

## D18. Cached server rendering; the build needs no database
- **Why:** caching reads for 10 minutes keeps Neon compute asleep most of the time. Building without a database keeps CI and preview deploys simple.

## D19. No personal data
- **Chosen:** investors are organisations only. Mentions of individual angels become a boolean flag. No founder names and no contact details.
- **Why:** names of individuals are personal data under UK GDPR. They aren't needed for the product's questions, and leaving them out removes the compliance burden. Any change needs a separate, documented decision.

## D20. Eval fixtures use real headlines with summaries written in our own words
- **Why:** headlines and URLs make the test realistic. Feed summaries are publisher text, so we don't commit them to a public repo. Each fixture paraphrases the facts instead. This makes the eval slightly easier than live input, and the README says so.

## D21. AGPL-3.0
- **Why:** anyone running a modified public instance must share their changes.

## D22. Vercel Hobby for now
- **Why:** it's free and integrates with Next.js. Hobby forbids commercial use (A12). The app avoids Vercel-only APIs so that moving host stays easy.

## D23. Tooling: pnpm, Node LTS, ESLint flat config and Prettier
- **Why:** pnpm's shared store makes several worktree installs cheap. ESLint with `eslint-config-next` catches Next.js-specific mistakes and enforces import boundaries. Prettier ends formatting debates. All are widely recognised.

## D24. Explicit sort semantics
- **Chosen:** relevance ordering applies only when a search query is present (and no explicit sort is chosen). Date is a tie-breaker, never the primary key in relevance mode. A test locks this in.
- **Why:** a previous design sorted by date first, so relevance had no effect.

## D25. Task-based development with file ownership
- **Chosen:** work is split into numbered task files. Each lists the files it may touch. Tasks in the same wave never share a file. Shared contracts (`src/core`, `src/db/schema.ts`, `package.json`) each belong to exactly one task.
- **Why:** this allows parallel work in separate git worktrees without merge conflicts, and each task is reviewable on its own.

## D26. Which feeds are on in Phase 1
- **Chosen:** TechCrunch Venture, Crunchbase News, Tech.eu, EU-Startups and UKTN. Sifted is off. Ingest runs hourly.
- **Why:** Sifted's RSS feed has no article summary, and its terms ban using the content to develop or validate AI. Crunchbase's terms ban training models on its content; the maintainer decided on 8 October 2026 that fact extraction is not training, so that feed stays on. Hourly polling is required because EU-Startups only keeps about a day of items.

## D27. Collect without an LLM key, and start early
- **Chosen:** `pnpm ingest run` works with no `OPENAI_API_KEY`. It collects, prefilters and keeps items pending, and `/status` says extraction is off.
- **Why:** RSS has no backfill, so each day without collecting is history lost for good. Collecting is free and items can be extracted later, so spending and collecting should not have to start together.

## D28. Country is scored only where the model states one
- **Chosen:** in the extraction eval, a model that returns null for a country counts as abstaining, reported as coverage. A stated country is right or wrong.
- **Why:** 7 of the 22 expected countries are not in the fixture text, and the prompt says not to guess. Scoring null as wrong would cap an obedient model at 68% against an 80% target, and reward guessing. Guessed countries also cause harm downstream, because a country conflict can split a company.

## D29. Fuzzy company matches need amounts that agree
- **Chosen:** this narrows spec section 7. A fuzzy name is confirmed only by agreeing amounts, not by a shared round type alone. Separately, an exact name with a differing country still matches if the event agrees. Differing domains never match.
- **Why:** seed is the most common round, so a shared round type within 45 days is weak evidence. A wrong merge corrupts two companies and is hard to spot, while a missed one waits in the review queue (D11). Countries are often inferred, so they should not outweigh matching event facts.

## D30. The run lock has its own direct connection
- **Chosen:** the lock lives on a dedicated connection, separate from the query pool. The pipeline refuses a Neon `-pooler` URL.
- **Why:** session advisory locks belong to one connection. Through a pool the unlock can reach another backend, and an idle-connection close can drop the lock mid-run. The in-process test database has a single connection and would hide this, so it was also tested against real Postgres with a competing session.

## D31. The script is `pnpm ingest`, not `pnpm pipeline`
- **Why:** pnpm 12 has a built-in `pipeline` command that takes priority over the script, so `pnpm pipeline run` fails. Task files written earlier still say `pnpm pipeline`.

## D32. Roundups count as events, with an approximate date
- **Chosen:** a roundup that names completed raises gives one event per raise. With no stated date, those events are marked `month` precision.
- **Why:** this matches the fixtures. A roundup can recap older rounds, so its publish date is only approximate, and the company page says "Around".

## D33. Extraction v2 adds `regionText` and tighter city and tag rules
- **Chosen:** one new nullable field, `company.regionText`, copied as the text states it ("Scottish", "Yorkshire"). Code maps it to an ITL1 region. The prompt (`v2`) also asks for a plain town name and for specific, industry-standard tags, with generic words banned. The change lands in wave 1, before any paid extraction.
- **Alternatives:** no change; a fixed `sector` field; an ITL1 code chosen by the model; extra fields such as employee count or B2B/B2C.
- **Why:** UK news often names a nation or region without a town, and V1 would lose it for good unless items were re-extracted. Copying text and mapping it in code follows D8. A sector field would make the model classify, which themes and the sector map do in code (D34, D35). Employee counts are rarely stated. Doing this before the first paid run means no re-extraction is needed.

## D34. Themes by greedy centroid assignment
- **Chosen:** tags are processed in a fixed order (mentions, then slug). Each joins the most similar theme centroid if cosine similarity is at least τ, otherwise it starts a new theme. τ is chosen by a labelled eval (Task 039). People can merge, move and rename.
- **Alternatives:** k-means (needs k, reshuffles themes on every run); HDBSCAN (no maintained TypeScript implementation, and also reshuffles); agglomerative clustering (O(n²) memory and a full rebuild each time); asking an LLM to group tags (costly, not reproducible).
- **Why:** the method is incremental and stable. Old themes never move when new tags arrive, so theme slugs in stored links keep their meaning. It is deterministic given stored embeddings, and each link records its similarity. The cost is order dependence, which the manual tools correct.

## D35. Theme slugs come from the seed tag; names belong to people
- **Chosen:** a theme's slug is its first tag's slug and never changes. The LLM suggests a name and a sector once. Manual names and sectors are never overwritten. Merged themes redirect.
- **Why:** an LLM name is a guess, and a slug derived from it would freeze the guess into URLs. The seed tag is meaningful and stable. Keeping the human decision final avoids an automated step undoing a review.

## D36. Rising score: a shrunk log ratio against the baseline share
- **Chosen:** *s* = ln((*r* + 3) / (*e* + 3)), where *e* is the theme's baseline share of rounds applied to the recent total. 8 recent weeks, up to 26 baseline weeks, at least 8 weeks of baseline. Counts, not money. Grants excluded. Themes need at least 3 recent rounds to be listed.
- **Alternatives:** a raw growth ratio (explodes on tiny counts); a z-score (unstable when expected counts are near 0); a Bayesian model with a fitted prior (harder to explain and test).
- **Why:** the pseudo-count shrinks small counts towards 0, so one round cannot top the chart, and leaves large counts almost untouched. Comparing shares, not raw counts, cancels growth in overall coverage. The score reads simply as "about 2× its usual share". Money is excluded because round sizes are heavy-tailed.

## D37. Derived tables are rebuilt as diffs, and only when inputs change
- **Chosen:** `company_themes`, `theme_weekly_stats`, `weekly_totals`, `funding_round_momentum` and `company_locations` are recomputed from source tables. Only changed rows are written, and the rebuild is skipped when an input fingerprint is unchanged.
- **Why:** full recomputation is simple and always correct, like canonical event fields (D12). Writing only differences keeps hourly runs from churning Neon storage and compute. These tables hold nothing that cannot be recomputed, so replacing their rows does not break "never delete historical data".

## D38. Charts are hand-written server-side SVG
- **Alternatives:** Recharts, Chart.js, Nivo (client-side or DOM-dependent); Observable Plot (needs a DOM shim on the server); visx (server-safe but many packages).
- **Why:** three simple chart types need about 300 lines of code we own. Rendering on the server means no client JavaScript and charts that work without it. Each chart has a caption and a data table for screen readers. There is no dependency to update.

## D39. UK location: ITL1 regions, towns and postcode districts from static open data
- **Chosen:** ITL1 (12 areas) for sub-regions. A committed gazetteer of UK towns and postcode-district centroids, built once from OGL data. "Near" is the distance between centroids.
- **Alternatives:** ITL2 or ITL3 (too fine for news, unfamiliar names); counties (inconsistent, overlapping); postcodes.io, OS Names API or Nominatim at run time (network dependency, keys or share-alike terms).
- **Why:** ITL1 is the official regional scheme and matches GtR's region names. Static data is deterministic, testable offline and free. Town-level precision is the best the news data supports, and the pages say what distance search cannot do.

## D40. Innovate UK grants from the Gateway to Research API
- **Chosen:** the GtR-2 JSON API, filtered to Innovate UK, collected daily. Organisations only (a legal-form suffix or a company number). Each kept participant becomes a company and a `confirmed` grant event, linked by `event_record_sources`, and is never matched to or overwritten by news events. Grant projects are tagged by a small batched LLM call so they join themes.
- **Alternatives:** the Innovate UK funded-projects spreadsheets (24 MB `.xlsx`, irregular updates, ukri.org content mostly CC BY-NC-SA 4.0); the GtR bulk download (885 MB); leaving grants out.
- **Why:** grant recipients are the small UK companies the targeting user wants, with postcode, amount and date. The API is free and keyless, its terms allow use for any purpose, and it supports backfill. Storing organisations only keeps sole traders' names out (D19). Keeping grant events apart from the news resolver avoids corrupting either until Phase 3 builds proper matching.

## D41. A versioned, canonical filter model
- **Chosen:** filters split into criteria and view. Criteria serialise canonically (fixed key order, sorted values, defaults omitted) and carry a version (2). Phase 1 URLs keep their meaning, apart from grants now being hidden by default.
- **Why:** each search needs one stable string, and old links must not change meaning silently. Building it now, while filters are simple, costs little.

## D42. Demand-signal collectors are last and cuttable; no YC directory
- **Chosen:** Hacker News and GitHub collectors are the final two waves and may be cut. Y Combinator directory data is not collected. The batch is read from Launch HN titles instead.
- **Why:** both sources support backfill or matter only for launches we already track, so delaying them loses little. The only practical YC source, the yc-oss mirror, still has no licence (A25).

## D43. Company momentum uses equity rounds and says "first recorded"
- **Chosen:** months since previous, step-up and rounds in 24 months use funding rounds other than `debt` and `grant`. Step-up compares with the latest earlier round that has an amount, within 36 months. Round numbers mean "recorded by SignalFeed".
- **Why:** debt and grants are not steps in an equity sequence, and would make step-ups meaningless. Amounts are often missing, so skipping back to the last known amount keeps the signal useful, and the 36-month limit keeps it relevant. History starts at collection, so claiming "first round" would be false.

## D44. Grants are hidden by default and excluded from trend counts
- **Chosen:** with no round filter, the funding table shows every round type except `grant`. Trend scores and momentum ignore grants. Grants have their own counts in weekly stats.
- **Why:** the grants backfill would swamp both the home page and the first months of trend data. Public grants are a different signal from venture rounds. Selecting "Grant" brings them back for the targeting user.

## D45: Phase 2 decisions confirmed by the maintainer (11 November 2026)

- Extraction v2 (`company.regionText`, sharper city and tag rules) is approved. The two small paid checks, the extraction eval and the theme clustering eval, are approved.
- The 16-sector list in `docs/spec-phase2.md` section 7.2 is approved as written.
- Grants are hidden on the funding table unless "Grant" is selected. The grants backfill starts on 1 April 2024.


## D46. Tags are embedded in a short template, and the theme eval labels markets
- **Chosen:** each tag is embedded as "Startup market: <tag>" (`tagEmbeddingInput`, template `market-v1`). `tags.embedding_model` and `themes.embedding_model` store `<model>+market-v1` (`tagEmbeddingIdentity`), so tags embedded with another template are embedded again and never mix with new ones. The greedy centroid rule (D34) is unchanged. τ is 0.76. The theme eval's labelled groups now follow a written market rule (`fixtures/themes/README.md`): one group per product or service, sector words only with their synonyms.
- **Alternatives measured** on the market labels (pairwise F1 at each method's best τ): bare tags 0.53; "Startup sector: <tag>" 0.57; "The <tag> market" 0.56; "Startup market: <tag>" 0.60. Joining by the most similar member (0.49 bare, 0.55 templated) or by the mean member similarity (0.52 bare, 0.59 templated) did no better than the centroid. A second pass that merges close theme centroids collapsed themes and lowered F1. Removing the template's own direction from each vector gave 0.59.
- **Why:** the template is the only change that helped, and it costs nothing at run time. The old 27 groups mixed markets with sectors (vector databases with prompt management, cultivated meat with meal kits), so they rewarded merging whole sectors. F1 0.58 on those groups (0.65 with the template) overstated quality.
- **Limits:** F1 is 0.60, below the 0.75 target (A26). Even a perfect clustering of these embeddings could not reach it: a plain cut on pair similarity peaks near 0.55. The model ranks tags by shared words ("prompt management" with "fleet management", the "-tech" sector words with each other) and places jargon far from its meaning ("baas", "black mass processing"). The template also packs similarities into a narrow band, so F1 falls fast below τ (0.49 at 0.74). Manual merge and move (spec 7.3) stay the fix for single errors.
- **text-embedding-3-large at 512 dimensions** (priced at $0.13 per million tokens, against $0.02) did not help: F1 0.55 at τ 0.84 with the template and 0.56 at τ 0.54 on bare tags, against 0.60 for the small model. Its pair similarities rank slightly better (a plain cut peaks at 0.59), but the greedy clustering does not turn that into better themes. The small model stays the default. `pnpm eval --themes --model <id>` scores another model.

## D47. An LLM check places tags in a similarity band
- **Update:** D48 measured a wider band with graded scores, and D49 stronger models. Neither met the new target, so this setting stays the default (D49).
- **Chosen:** two bands around the greedy rule (D34). A tag whose best centroid similarity is at least τ_high = 0.88 joins that theme. Below τ_low = 0.72 it starts a new theme. In between, `gpt-5.6-luna` sees the tag and up to 3 candidate themes (each shown by its top 6 tags) and picks one or none. Calls are batched 20 tags at a time, use a strict schema with no string length keywords, and go through `LlmClient` and `BudgetGuard` with purpose `theme_naming`. A new purpose value would need a database migration, and theme naming is already the purpose for theme LLM calls. On a budget refusal or provider error, the band tags fall back to the embedding-only rule at τ = 0.76, so the assignment run is never lost. With no key, assignment is embedding-only, as before.
- **Measured** on the 215 labelled tags, replaying recorded verdicts (`docs/theme-eval-results.md`): embedding-only 0.604 F1 (precision 0.540, recall 0.685). With the check at 0.72 to 0.88: 0.662 F1 (precision 0.930, recall 0.515). Other bands: 0.72 to 0.84 gave 0.651, 0.74 to 0.88 gave 0.646 and 0.76 to 0.88 gave 0.632. Wrong merges fall from 239 to 16.
- **Prompt:** version `theme-check-v2` states the market rule from `fixtures/themes/README.md` with examples that are not in the labelled set. The first version, which used three labelled tags as examples and a looser wording, reached 0.681 F1 at 0.72 to 0.84, but with precision 0.694. v2 is kept: it is 0.02 lower on F1 but makes far fewer wrong merges, and it does not quote the test set.
- **Merge check between themes: not built.** A trial asked about the 94 pairs of themes from the chosen run whose centroids were at least 0.76 alike ($0.0033). The LLM called none of them the same market, so F1 did not change. A perfect judge on the same pairs would have reached about 0.84, so the gap is the model's narrow reading of "market", not the pairing. The trial's answers are in `fixtures/themes/recorded/merge-trial-gpt-5.6-luna.json`.
- **Cost:** 249 questions in 15 calls for the 215 tags, starting with no themes. That is about 21 calls and $0.037 for 300 new tags, at $0.000106 a question. Most of the cost is reasoning tokens. The first live run cut answers off at 2,600 output tokens and lost 400 questions, so a call now allows 4,000 tokens plus 50 a tag.
- **Limits:** F1 0.662 is below the 0.75 target (A26), and the target test still fails. With perfect verdicts the same bands would reach about 0.87, so the limit is the model's judgement against these labels. It splits finer than the labels in some markets ("threat detection" from "cybersecurity", "cross-border payments" from "payment rails") and joins neighbours in others ("vehicle-to-grid" with electric vehicles, "lettings platform" with estate agency software). Low recall means more small themes. `pnpm themes suggest-merges` and `merge` fix them, and a missed merge is safer than a wrong one.
- **Eval:** verdicts are recorded once per model, prompt version and embedding recording, keyed by the exact question the LLM saw, so a change of prompt, band or embeddings asks again rather than reusing a stale answer. A prompt hash catches unversioned edits. `pnpm eval --themes --check --live` records missing verdicts one pass at a time, as production asks them, with a $0.05 cap a run. This decision used $0.098 of live calls.

## D48. A wider band and graded scores for the theme check; meanings and full placing measured
- **Target:** F1 at least 0.80 with precision at least 0.85, so themes can run without review. Running cost at most about $0.25 per 300 new tags.
- **Result:** the best option measured is τ_low 0.64, τ_high 0.88 with graded scores (prompt `theme-check-v4`): a tag joins the best candidate at 7 or more out of 10. It gives F1 0.736, precision 0.794, recall 0.685 and 73 wrong merges, for about $0.074 per 300 tags. **The target is not met.** It was the default briefly; D49 restores the D47 setting, because only that one reaches precision 0.85.
- **Measured** (pairwise, 215 labelled tags, recorded verdicts):

| Method | Precision | Recall | F1 | Wrong merges | Per 300 tags |
|---|---|---|---|---|---|
| Embedding only, τ 0.76 | 0.540 | 0.685 | 0.604 | 239 | $0 |
| D47: band 0.72 to 0.88, one answer | 0.930 | 0.515 | 0.662 | 16 | $0.037 |
| 1. Band 0.64 to 0.88, first graded prompt (v3) | 0.579 | 0.834 | 0.683 | 249 | about $0.08 |
| 1. Band 0.64 to 0.88, graded prompt v4 (chosen) | 0.794 | 0.685 | 0.736 | 73 | $0.074 |
| 1. Same, τ_high 0.92 | 0.804 | 0.651 | 0.720 | 65 | $0.090 |
| 2. Meanings, then band 0.62 to 0.80 | 0.769 | 0.617 | 0.685 | 76 | $0.048 |
| 3. LLM places every tag among 8 themes | 0.714 | 0.810 | 0.759 | 133 | $0.131 |

- **Option 1, a wider band.** Moving τ_low from 0.72 to 0.64 lets the LLM see most true pairs. The one-answer prompt of D47 was too strict for that, so it now scores candidates. A first scale (v3) put sub-types with synonyms and merged whole sectors. v4 separates "a narrower part of the same product" (6 or 7) from "a sibling product" (4 or 5). Cut-offs of 6 and 8, replayed with some verdicts missing, did no better (F1 about 0.74 at precision 0.71, and about 0.55). τ_high above 0.88 sends a few wrong automatic joins to the LLM but costs more recall than it saves. In a simulation, showing 5 candidates instead of 3 stopped the passes from settling.
- **Option 2, describe then embed.** The LLM writes a 6 to 15 word meaning for each tag ($0.021 per 300 tags), and the tag is embedded as "Startup market: <tag> — <meaning>". Embedding-only F1 fell from 0.604 to 0.589, though the most similar pairs became more precise. With the check it reached 0.685. Not adopted. The code that writes meanings (`src/pipeline/embed/describe-tags.ts`) is kept for the eval and is not called by the pipeline, so no migration was added. The model's "broad sector word" flag was too noisy to use as a rule ("agentic ai", "ecommerce" and "cybersecurity" were marked broad).
- **Option 3, the LLM places every tag.** Embeddings shortlist the 8 closest themes and the LLM scores each one. Scores are kept per tag and theme, so only new candidates are asked about. Recall rose to 0.810 but precision fell to 0.714. Not adopted: it costs more and makes the most wrong merges.
- **Why not met:** the limit is the model's sense of where one market ends. With a perfect judge, the chosen bands would reach about 0.94. The errors split two ways against the labels. The model joins neighbours ("e-bikes" with electric vehicles, "earth observation" with satellites, "buy now pay later" with embedded finance, several robotics markets with industrial automation, "tutoring marketplace" with online learning) and lets specific markets join a sector word ("last-mile delivery" with logistics). It also leaves parts of a labelled market alone ("threat detection" apart from cybersecurity). A score cut-off cannot fix both, because the same scores are given to right and wrong joins. A hand-made list of sector words would fix several errors, but it would be fitted to this test set, so it was not tried.
- **Cost:** the chosen method makes about 509 questions in 30 calls for the 215 tags, so about $0.074 per 300 new tags, inside the limit. Live calls for this decision cost $0.251 of the $0.50 approved: option 1 $0.123 (with the v3 trial), option 2 $0.034, option 3 $0.094.
- **Next:** a stronger check model (gpt-5.4-mini costs about four times as much, near the limit), or labels reviewed against the market rule where the model and the labels disagree.

## D49. A separate check model; luna and the D47 setting stay the default
- **Chosen:** `THEME_CHECK_MODEL` sets the theme check model, separately from `EXTRACTION_MODEL`. It stays `gpt-5.6-luna`. If the check model fails with anything other than invalid output, the rest of the run uses the extraction model. No configuration met F1 0.80 with precision 0.85. By the rule for that case, the default is the best option with precision at least 0.85: the D47 setting (band 0.72 to 0.88, one answer, prompt `theme-check-v2`). It gives F1 0.662, precision 0.930 and 16 wrong merges, for about $0.037 per 300 tags.
- **Prices**, checked on OpenAI's pricing page (developers.openai.com) on 11 November 2026: `gpt-5.4-mini` $0.75 in, $4.50 out per million tokens, as in `pricing.ts`. `gpt-5.6-terra` $2 in, $12 out, now in `pricing.ts`. The deprecations page lists no shutdown for `gpt-5.4-mini`; the shutdown on 1 April 2027 is for `gpt-5.4-nano`.
- **Measured** (215 labelled tags, recorded verdicts, graded prompt v4):

| Model | Band | P | R | F1 | Wrong merges | Per 300 tags |
|---|---|---|---|---|---|---|
| gpt-5.6-luna, one answer (default) | 0.72–0.88 | 0.930 | 0.515 | 0.662 | 16 | $0.037 |
| gpt-5.6-luna | 0.64–0.88 | 0.794 | 0.685 | 0.736 | 73 | $0.074 |
| gpt-5.4-mini | 0.64–0.88 | 0.591 | 0.556 | 0.573 | 158 | $0.091 |
| gpt-5.4-mini | 0.72–0.88 | 0.678 | 0.641 | 0.659 | 125 | $0.043 |
| gpt-5.4-mini, least score 8 | 0.72–0.88 | 0.705 | 0.588 | 0.641 | 101 | $0.044 |
| gpt-5.6-terra | 0.64–0.88 | not finished | | | | about $0.55 |

- **gpt-5.4-mini** reasons far less than luna, so it costs only about 20% more a question. But it lumps more: it joins specific markets to sector words ("telehealth" into digital health, "freight forwarding" into logistics) and merges neighbours ("neobank" with embedded finance). No band or cut-off came near precision 0.85.
- **gpt-5.6-terra** cost $0.00078 a question in its first round, so a run would cost about $0.55 per 300 tags, over the $0.30 limit. It was stopped after 60 questions ($0.047) and cannot be the default whatever its quality.
- **Live spend:** $0.139 of $0.40: mini $0.092, terra $0.047.
- **Code:** the eval takes `--check-model`. The graded and placing modes stay as settings (`scores`, `pairScores` on `ThemeBands`), so every recorded option still replays.

## D50. Ship the strict theme setting; measure again on real tags (12 November 2026)

**Decision.** The maintainer chose the strict D47 setting as the Phase 2 default: `gpt-5.6-luna`, band 0.72-0.88, one answer per tag. On the labelled set it scores precision 0.93, recall 0.52 and F1 0.66, at about $0.037 per 300 new tags. The theme eval now guards this level (precision >= 0.90, F1 >= 0.65). The F1 >= 0.80 target from D48 is retired until there is a trustworthy answer key.

**Why.** SignalFeed should run hands-off. A wrong merge puts companies under the wrong market, and nobody will find it. A missed merge splits one market into two correct themes, which is visible and fixed with `pnpm themes merge`. The balanced setting (F1 0.74) made 4.5 times as many wrong merges (73 against 16). Stronger models did not help: `gpt-5.4-mini` lumped more, and `gpt-5.6-terra` was over budget (D49).

**What comes next.** The labelled set was written by an agent, under a strict one-market rule. Part of the remaining gap may be in the labels, not the method. At go-live (Task 045):
1. The maintainer labels about 100 real tags once (about 20 minutes), giving a trustworthy answer key.
2. The check is given each tag's company context (its one-line description), which real data provides.
3. If open grouping is still weak, move to classifying tags into a curated list of about 100 named markets under the 16 sectors.

**Cost.** About 3p a month for the theme check. The whole pipeline is expected to stay under £1 a month inside the £3 cap.


## D51. Phase 3 scope: Companies House first, Form D to confirm, no events from filings alone (planning, 12 November 2026)
- **Chosen:** Companies House linking and company facts come first, because they serve the main audience of people who sell to startups (small UK agencies and recruiters). SEC Form D is collected to confirm US news rounds and link CIKs. A news round becomes `confirmed` when a filing matches it. Filings never create events on their own in Phase 3: not Form D, not SH01. No extraction change and no paid calls.
- **Alternatives:** events for every Form D issuer (about 17,000 non-fund offerings a year, mostly not startups: real estate, oil and gas, local businesses); events from every SH01 (option exercises, conversions and share-for-share exchanges look the same in the metadata).
- **Why:** both alternatives would fill the site with things that are not startup raises, and telling them apart needs judgement the data does not support. Stored Form D filings let the go-live review measure how many young tech and health issuers news misses, so the question can be decided on numbers (spec-phase3 section 13.3).

## D52. Companies House through the REST API, not the bulk snapshot or the stream
- **Chosen:** the public data API with a free key, at no more than 500 requests in five minutes (the limit is 600). Profiles refresh every 90 days, weekly for companies with a recent unconfirmed round.
- **Alternatives:** the free company data product (a monthly 471 MB zip of CSV, live companies only, no licence on the page); the streaming API (two connections at most, every change on the register).
- **Why:** SignalFeed needs a few thousand companies, about 3,500 requests a month after a one-off backfill of about 30,000. The snapshot would need unzipping and parsing 5 million rows a month to use a few thousand, and lacks dissolved companies and filing history. The stream suits whole-register mirrors. A shared-address count, which the snapshot could have given, comes from the advanced search instead (A37), with a fallback.

## D53. Registry links: exact name plus a supporting fact, or no link
- **Chosen:** a company is linked automatically only when exactly one registry company matches its name exactly (or by a previous name), nothing conflicts (incorporated after the first event, dissolved before the last, dormant through a round, no share capital, founded year more than 2 years off), and at least one fact supports it: the grant postcode, a registered office within 25 km of its known town, or an SH01 within 120 days before to 30 days after a reported round. A trading-name prefix match needs both the location and the filing. Everything else is a review candidate or unlinked. Manual decisions are final. A number wanted by two companies makes a merge candidate. Rules are pure functions with a labelled eval that must show no wrong automatic link.
- **Alternatives:** take the top search result; fuzzy name similarity; an LLM judge; officer names as evidence.
- **Why:** a wrong link puts another company's age, status and size on a real company's page, and nobody would notice. A missed link only leaves a gap. Short brand names often match an unrelated old company ("Nova Ltd"), so a name alone is never enough. Officer names would help but are personal data (D58). Fuzzy and LLM matching are harder to explain and test, and the review queue already covers the hard cases (D11).

## D54. "Confirmed" means a record shows the event happened; it is derived
- **Chosen:** a news round is `confirmed` when a matching SH01 or Form D exists in its date window. Amounts, round type and investors stay as reported; `confirms_amount` says when a Form D amount agrees. Confirmations live in a derived table rebuilt by the hourly run, and `events.evidence` follows it. The Phase 2 guard that protected grant events by `evidence = confirmed` changes to "has an `event_record_sources` row" before any news event can be confirmed.
- **Alternatives:** overwrite amounts and dates from the filing; a separate "verified" column; keep the old guard.
- **Why:** SH01 metadata cannot give the amount raised, and Form D amounts are often the whole offering, so replacing news facts would make them worse as often as better. The marker says exactly what the record shows. Deriving confirmations keeps them correct when events are re-extracted or merged (D12, D37). Keeping the old guard would stop later news reports from matching a confirmed round and create duplicates.

## D55. SH01: metadata only; reading the documents is deferred
- **Chosen:** Phase 3 stores SH01 filing metadata (allotment date, statement of capital), which is free and enough to confirm that shares were issued. Reading the amount from the PDF is not built; it would first need a vision model measured against Tesseract OCR on 30 labelled documents.
- **Why:** the PDFs are images, so reading them needs OCR or a vision model. A vision read costs about 0.2p a document on `gpt-5.6-luna` if it accepts images (A43). That is under £0.10 a month for documents that confirm news rounds, but £0.75-£1.50 a month for every SH01 of every linked company, most of the £1 normal budget, and then the hardest question remains: was the allotment a raise at all? Accuracy is unmeasured. The pages SignalFeed would send must exclude the presenter's contact details.

## D56. News reports of a grant attach to the grant event
- **Chosen:** in the resolve step, a news funding round of type `grant` attaches to the company's grant event when the date is within 180 days before to 60 days after the grant start and the amount is within 15% of the grant offer or the project cost (or there is no amount and only one grant in the window). The grant keeps its record facts; reports add headlines and investors. A one-off relink fixes reports stored before Phase 3.
- **Alternatives:** keep two events and hide one in every query; merge the grant into the news event.
- **Why:** hiding duplicates would touch every read query and every stats table. Merging into the news event would lose the official amount and date. News often reports the whole project cost, so both figures are compared.

## D57. Registry facts fill gaps; they never overwrite news
- **Chosen:** the incorporation year fills `founded_year` only when it is empty (source `companies_house`, or `sec_form_d` from a Form D). Registry status is shown from the registry table and never written to `companies.status`. SIC codes give sectors only to companies with no theme sector. The registered office gives a location only when no news town is known, the postcode is not shared by 20 or more active companies, and it agrees with any region the news states.
- **Alternatives:** the registry always wins; SIC sectors added to theme sectors; the registered office ahead of the news town.
- **Why:** a company often incorporates a new holding company for a round, so its incorporation date can be years after it was founded. Tech startups pick generic SIC codes (`62020`, `70229`), which would blur sector filters that themes already answer. Registered offices are often a formation agent or accountant in another city. Keeping each fact where it is most reliable, and showing the registry facts beside the news ones, makes conflicts visible instead of hiding them.

## D58. No personal data from registries
- **Chosen:** the officers, persons with significant control and charges endpoints are never called. Form D related persons, sales recipients, phone numbers and street addresses are stripped before parsing and never stored. SH01 documents are not stored. The full registered office postcode is stored for the shared-address check but never displayed; pages show the postcode district.
- **Why:** this extends D19 to official sources. Names of directors, shareholders and promoters are personal data under UK GDPR and are not needed for the product's questions. A small company's registered office can be a director's home, so only the district is shown.

## D59. Company size from the last accounts type, with "full accounts" not meaning large
- **Chosen:** six bands from `accounts.last_accounts.type`: micro, small (small, total exemption, abridged and similar), medium, "full accounts (size not stated)", dormant, and "no accounts filed yet". Offered as the `cosize` filter.
- **Alternatives:** employee counts from iXBRL accounts; treating full accounts as large.
- **Why:** the accounts type is in every profile at no extra cost. Small companies may choose full accounts, so calling them large would be wrong. Employee counts from iXBRL would be more precise and cost no LLM, but need a document fetch per company and a parser; they can come later if the size filter proves useful. The accounts regime may change from April 2028 (A46); the mapping is one table.

## D60. Filter criteria version 3: `evidence` and `cosize`
- **Chosen:** two new criteria, both defaulting to "no filter": `evidence=confirmed` and `cosize` (multi). `FUNDING_CRITERIA_VERSION` becomes 3, with the same canonical serialisation rules (D41). Version 2 URLs keep their meaning.
- **Why:** the maintainer asked for a "confirmed" filter, and the size band is the main new targeting fact. New parameters with "no filter" defaults change nothing for old links. The sector filter now reads `company_sectors`, falling back to the theme join, so it never returns fewer rows than before.

## D61. Phase 3 decisions confirmed by the maintainer (12 November 2026)

- **Form D confirms only.** A Form D filing confirms a matching news raise and links a US company to its SEC CIK. It never creates an event on its own.
- **SH01 reader deferred.** Reading amounts from the SH01 documents is not built. Raises are confirmed from free SH01 metadata (the allotment date).
- **Partial name matches go to review.** Only exact or near-exact name matches with supporting evidence link automatically. Trading-name prefix matches ("Voltmoss" and "Voltmoss Energy Systems Ltd") go to the review queue.
- **Companies House incorporation year wins.** When news and Companies House disagree, the page shows the incorporation year and the news year stays stored.
- **Defaults accepted:** a registered address shared by 20 or more companies is treated as a formation agent's address, not a location. Link review at go-live (Task 066) is a one-off maintainer check of about 50 links.

## D62. Country hints choose who is searched; they never decide a link (14 November 2026)
- **Chosen:** a company with no stated country (or GB) is searched in Companies House when it has a hint: a GBP round (`gbp`), a report from a UK-only source (`uk_source`), or an unambiguous UK town or region in its extractions or `companies.city` (`uk_place`). The UK-only sources are listed in `SOURCE_COUNTRY_HINTS` in `src/pipeline/sources.ts`, next to the source config (today only UKTN). A known country other than GB never takes a hint. The queue runs by tier, then newest event: grant with a company number, other evidence, two or more hints, GBP or UK source, UK place only. The link rules (D53, D61) are unchanged, and the link eval has four hinted cases (ch-57 to ch-60). A link or candidate found through hints alone ends its reason with "searched on hint: …; country not stated", which `pnpm registry list` shows, and the run logs a count per hint. For Form D, a company with no country was already considered, so nothing widens; null-country reasons now say whether a USD round supports them.
- **Not chosen:** writing the hinted country, or GB from a Companies House link, into `companies.country_code`. A hint is not a stated fact. A link can also be demoted by a later refresh or a manual unlink, and the column has no provenance to undo it. Resolve only fills the country when it is empty and treats different countries as a conflict, so a guessed GB would block the country a later report states and could split one company in two. A derived "UK through registry link" for locations can come later if it is needed.
- **Also not chosen:** a `sources.country_code` column (a migration for one row of config; the `sources` rows are seeded from `SOURCES`), and the currency of every round as a hint (EUR does not point to one country, and many non-US companies raise in USD).
- **Why:** after the first live run (14 November 2026) only 8 of about 58 companies were searched, because news often gives no country. Searching costs requests, not precision: a wrong search ends as `none` or a review candidate. The weakest hint, a UK place name, also matches places abroad ("Boston", "Perth"), so it runs last. Expected cost: about 1-3 extra companies a day at about 5 requests each, so 5-15 requests a day, well within `MAX_CH_REQUESTS_PER_RUN` (2,000) and the 500-in-five-minutes limiter, plus a one-off catch-up of a few hundred requests.

## D63. The registry step has a time limit, says why a company failed, and searches news companies first (17 November 2026)
- **Chosen:** `MAX_CH_MINUTES_PER_RUN` (default 17, whole minutes 1-60). The link pass and the refresh pass share one deadline, carried on `RequestBudget`. It is checked only between companies (and between profiles), never part way through one. On reaching it the step stops like the request limit: the rest stays due, the step still rebuilds confirmations, locations and sectors, and the stats say `stoppedAtTime: true` (the daily summary shows "Stopped early: time limit"). The client also refuses to start its 5-minute rate-limit wait when less than 5 minutes remain, and the step stops instead. `timeout-minutes: 25` stays as the backstop.
- **Why:** the grants backfill (PR #19) added about 2,280 grant-recipient companies, all GB, so the queue grew from about 10 to about 1,425 companies. At 2,000 requests a run and the 500-per-5-minutes limiter, linking alone needs at least 20 minutes, and the rebuilds follow. On 15 and 16 November the step hit its 25-minute `timeout-minutes` and was killed, so the daily job failed and the summary had no registry result. The killed step's Postgres session still held the ingest advisory lock when Form D started a second later, so Form D printed `{"ran":false}` and did not run for two days. Stopping cleanly removes the cause, so the lock is not changed.
- **Error messages:** `describeError` gives `name: message` for any `Error`, plus the `code` and `message` of its `cause` (Drizzle wraps the driver error, and its own name is plain `Error`). Text after `params:` is dropped, any `Basic` token is redacted, and the result is capped at 300 characters. `ChApiError` messages are unchanged. Errors from `ch-client` are already scrubbed of the key. About 100 companies failed every run with only "Error" in the log, so the cause could not be read.
- **404 rule:** the advanced search endpoint answers 404 when nothing matches. `countActiveAtPostcode` now returns 0 for it. A 404 from basic search is still an error, and a 404 for a profile or filing history is still "not found".
- **Ordering:** within a tier, companies with a news report (an `event_sources` row on any event) come before companies whose events all come from grants, then newest event, then id. Tiers and hints (D62) are unchanged, so newly reported UK startups no longer wait behind the grant backlog.
- **Not chosen:** recording failed attempts so they back off (revisit after reading the new messages from a live run), reading `X-RateLimit-Reset`, and releasing the advisory lock on kill or retrying it in Form D.

## D64. A company website links only on a company number, a stated source with the name, or a name match the LLM confirms (23 November 2026)
- **Chosen:** one pure function (`decideWebsite` in `src/pipeline/websites/rules.ts`) decides each candidate domain from the company's facts, the homepage summary (`fetch-page.ts`), where the domain came from and who else holds it. The rules are checked in order and the first that applies decides:
  - **X1 rejected:** a host that is never a company's website (`non-company-hosts.ts`: search, social, news, data and directory hosts, government and registry hosts, publishing and code hosts, app stores, link-in-bio pages and accelerators, matched by host, subdomain or registrable domain, so `apps.apple.com` in an article counts), an investor's website in our data, a page that was not read (robots.txt, a 401/403/429 block, a failed fetch, not HTML, the run's page limit) on a guessed domain, or a parked or for-sale page (GoDaddy's holding page, an empty page whose script jumps to `/lander`, counts as parked).
  - **X2 rejected:** the page shows UK company numbers and none of them is the company's linked Companies House number (a reseller, a parent or another business with the same trading name).
  - **X3 candidate:** another company already holds the domain (a `linked` row or its `website_domain`), reason "domain held by …".
  - **W1 linked:** the page shows the company's own Companies House number.
  - **W2 linked:** the domain came from the article or the company's own UKRI record, it did not redirect to another registrable domain, and the name matches.
  - **W3 linked:** the name matches, is not too short or generic, and the LLM check says `same`.
  - **C1 candidate:** as W3, but the LLM says `unsure`, the budget guard refused the call, or the answer failed the schema.
  - **C2 candidate:** the domain came from the article or the UKRI record, and the LLM did not say `different` (a rebrand, a holding page, a page whose title does not carry the name), or its page could not be read for any reason but the page limit (quantum-systems.com answers 403 to automated requests, but the article named it).
  - **Otherwise rejected** (rule `none`), with the reason in the evidence.
- **Name match** (`name-match.ts`): the company name or an alias equals the page's `og:site_name`, or one part of its title, under `registryNormalise` with spaces ignored (the registry rules' exact match). Titles split on `|` and `·`, on `:` before a space, and on `-`, `–`, `—`, `/` or `\` between spaces, so "Home \ Anthropic" matches and "Optimise-AI" and "21:12 Communications" stay whole. A name of 3 characters or fewer once normalised, or one that `isPlaceholderCompanyName` flags, never links on a name match: it needs W1 or W2, and the LLM is not asked.
- **LLM check** (`llm-check.ts`): `gpt-5.6-luna` through `BudgetGuard`, purpose `website_check` (migration `0006_website_check_purpose` adds the value). Input: the company's name, description, first tag, city and country, and the page's domain, title, `og:site_name`, meta description and first 1,500 characters of visible text, with the page marked as data, never instructions. Output, strict: `{ "verdict": "same" | "different" | "unsure" }`. It is asked only when the rules reach W3, so about 700 input tokens per call and a few calls a day. A budget refusal makes no call and gives C1. Output that fails the schema is recorded as spend and gives C1. Any other error (a rejected key, a network failure) is thrown, so nothing is written for that candidate.
- **Store** (`website-store.ts`), mirroring the registry link store (D53): a manual decision is final, and while a company has a manual link no automatic result is written for it. One company has at most one `linked` domain and a domain is linked to at most one company: a second strong result becomes a `candidate`, and a domain another company holds becomes X3 even if it was free when the rules ran. `companies.website_domain` is set from the `linked` row and cleared when that row is demoted or rejected. A re-check that could not read the page leaves an automatic link or candidate in place; a re-check with any other result replaces it.
- **Review:** `pnpm registry list --websites` shows open candidates with the company's description, the rule, the evidence and the URL to check. `pnpm registry approve --website <id>` links a candidate as a manual decision (refused while the company has another linked domain or another company holds it). `pnpm registry reject --website <id>` rejects any row, linked ones included, for good.
- **Eval:** `pnpm eval --websites` replays the labelled cases in `fixtures/websites/` through the rules, the LLM check and the store on an in-memory database, with recorded LLM answers, so it costs nothing. The gate is no wrong automatic link; recall is reported. The cases are real companies, with page summaries read from their homepages or written by hand on `.example` domains, and the labels wait for the maintainer's check. `pnpm eval --websites --live` (maintainer only, capped at $0.05) records the model's answers in place of the hand-written stand-ins.
- **Fetching:** a bare domain whose homepage fails is retried once at `www.` as part of the same page (mindfoundry.ai redirected to a 404 page, while www.mindfoundry.ai answered).
- **Not chosen:** linking a stated domain after a redirect to another registrable domain without the LLM (the source vouched for the old domain, not the new one); X3 for an investor's website (it is never a portfolio company's website, so review would only add work); demoting a link when a re-check is blocked (a block says nothing about the domain); and a name match on the title as a substring ("Welcome to Acme"), which matches too many unrelated pages.
- **Why:** precision comes first. A wrong link puts another organisation's site on a company's page, while a missed link only leaves a gap. A company number or a domain the article printed is strong evidence. A name match on a guessed domain is weak on its own, because short brand names are shared across countries and sectors (archer.com, playbook.com), so the LLM compares what the page does with what we know of the company, and anything it cannot confirm goes to review.

## D67. The hourly run only does what must be fresh; the slow paid work moves to the daily `enrich` (20 November 2026)
- **The stall:** every hourly run since 14 November was cancelled at its 20-minute `timeout-minutes`. The log showed the feeds fetched, then nothing. The database showed collection, prefilter and extraction finished (all 149 items `extracted` or `filtered_out`), so the hang was in the later steps. 14 November was the day the grants backfill (PR #19) added about 2,280 grant companies and their projects, so grant tagging (up to 200 LLM calls), grant resolution, tag embedding and themes all faced a large backlog every hour. The pipeline logged nothing per step, so the slow one was not known. Cancelled runs also left their `ingest_runs` row `running` forever.
- **What moved:** `run` (hourly) keeps collect, prefilter, extract, resolve and FX, then the cheap database-only rebuilds: locations, stats, confirmations, sectors. Grant tagging, grant resolution, tag embedding and themes (assignment and naming) moved to `runEnrich` and `pnpm ingest enrich`, a new step in `daily.yml` after grants and before the registry step. It takes the ingest lock and records its own `ingest_runs` row, in the old order. A budget pause or provider refusal stops the paid steps after it, as before, and the run is `budget_paused` or `failed` as before.
- **Why this split:** news is the only thing that must be fresh within the hour (EU-Startups keeps about a day of items). Grant and theme work depends on the daily grants collection, costs money, and a day's delay is invisible on the site. The rebuilds stay hourly because they are cheap, skip when nothing changed, and keep a new round correctly labelled within the hour. After `enrich`, the next hourly run rebuilds locations, stats and sectors from the new data.
- **Two time limits:** `MAX_INGEST_MINUTES_PER_RUN` (default 12) for the hourly run and `MAX_ENRICH_MINUTES_PER_RUN` (default 15) for `enrich`, whole minutes 1-60, parsed like `MAX_CH_MINUTES_PER_RUN` (D63). The limit is checked between steps and between items: extraction items, resolved extractions and FX conversions in the hourly run; tagging batches, embedding batches and theme-check or naming batches in `enrich` (these loops already stop on a budget refusal, so a budget guard that also refuses after the deadline stops them before the next paid call, and the stats say time, not budget). Nothing is stopped inside a database write or an LLM call. On reaching it the run stops cleanly, leaves the rest for the next run and records `stoppedAtTime: true`. The hourly rebuilds always run after the limit. `enrich` skips embedding and themes if time is up after grants. `timeout-minutes` (20 hourly, 18 for the enrich step) stays as the backstop. Grant resolution has no per-participant check yet (its loop is in `resolve-grants.ts`); it is local and free, so it runs to the end.
- **Per-step timing:** each step logs one line when it ends, `step extract: 4.2s (6 items)`, to stderr. Its duration goes into the run stats as `stepMs` (whole milliseconds by step name: `collect`, `prefilter`, `extract`, `resolve`, `fx`, `locations`, `stats`, `confirm`, `sectors` hourly; `grantTagging`, `grantResolution`, `embed`, `themesAssign`, `themesName` in `enrich`). The workflow summaries show the durations.
- **Abandoned runs:** when a locked run starts (`run`, `enrich`, `grants`, `registry`, `formd`), any `ingest_runs` row still `running` and started more than 60 minutes ago is set to `failed` with `error = 'abandoned: the job was stopped before it finished'` and `finished_at` now. It happens inside the lock, so a live run is never touched. The status page already shows `failed` runs, so it needed no change.
- **Not chosen:** raising the hourly `timeout-minutes` (it hides the cause and still blocks the lock for the next hour), running enrich as its own workflow (one more schedule to keep alive; the daily job already has the lock discipline and summary), and stopping inside a tagging batch (a paid call must be recorded).

## D68. We honour robots.txt for every publisher fetch (20 November 2026)
- **Found:** the RSS collector never read `robots.txt`. Tech.eu disallows `/feed/` and UKTN disallows `/feed` for all agents (`User-agent: *`), and we had been fetching both feeds hourly. The maintainer is writing to both sites to ask permission.
- **Chosen:** before any request to a publisher host the pipeline checks that host's `robots.txt` (`src/lib/robots.ts`, RFC 9309) for our product tokens `SignalFeed` and `Raisory`, falling back to `*`. Longest match wins and `Allow` wins a tie; `*` and `$` work; `Crawl-delay` is read and used to space requests to one host (capped at 60 seconds). Today the only publisher fetch is the RSS feed (the pipeline fetches no article or page); the other HTTP clients call registry and data APIs, not publishers.
- **Status rules:** 2xx parses the file. 4xx means no rules, so allowed. 5xx, any other status, a network error or a timeout means the whole host is skipped for this run and tried again next run.
- **Cache:** in memory, per host, 24 hours, so one extra request per host per run. Nothing is stored in the database (no migration).
- **Skips are not failures:** a skipped feed gets outcome `robots_disallowed` (or "robots.txt unavailable" for the 5xx case), the log says `Feed tech-eu skipped: disallowed by robots.txt`, the run stats count it in `collect.sourcesSkippedRobots`, and `sourcesFailed` does not change. The `ingest.yml` summary shows "Feeds skipped (robots.txt)".
- **Consequence:** until Tech.eu and UKTN allow us, their stories only reach us through the other feeds. The sources stay enabled in `SOURCES`, so a change on their side takes effect on the next run.

**Amendment (20 November 2026):** a 401, 403 or 429 answer for robots.txt now counts as disallowing the whole host for the run, which is stricter than RFC 9309's "4xx means allowed". The first live run after D68 showed why. Tech.eu blocks GitHub's IPs, so its robots.txt answered 403, and the reader went on to request `/feed/`, which Tech.eu's robots.txt disallows. A host that refuses us its rules is treated as not wanting to be read. 404 and 410 still mean "no rules".

## D69. Extraction reads the article opening; a placeholder company name is never published; names can be fixed by hand (23 November 2026)
- **Found:** BusinessCloud's "Monzo alumni raise £1.8m for startup as Burbidge invests" (source item 1635) became a company called "startup" (company 2391, slug `startup`). The feed summary never names the company ("The startup's team previously built machine-learning scam models at Monzo…"), so the model took a word from the headline. The body in the same feed item, `content:encoded`, opens with the name, Acorda. A stronger model would not have helped: the name was not in its input. There was also no way to correct a name by hand or to re-run one article.
- **Article opening:** when a feed item carries a body (RSS `content:encoded`, or an Atom `content` element longer than the summary), the collector keeps its opening as plain text in `source_item_texts.lead` (migration `0004_source_item_lead`): the first sentences, at most 150 words and 1,000 characters, cut at a sentence end where one fits and at a word otherwise. Captions, figures, embedded posts, quotes, headings, scripts and the "The post … appeared first on …" line are removed. The opening is read for extraction only and never displayed. The web role cannot read it: `scripts/sql/roles.sql` already revokes all access to `source_item_texts`, which covers the new column. Like the summary, it is article text and can mention people; nothing from it is stored as an entity fact except through the extraction rules (no names of individual people).
- **Backfill:** when the collector sees an item it already has and its stored opening is empty, it fills the opening from the feed. Nothing else about the item changes, and it is not re-extracted on its own; use `reextract --item` for that. A stored opening is never replaced.
- **Which feeds carry a body:** listed in `docs/sources.md` ("Article bodies in feeds"). BusinessCloud, Tech Funding News and The Recursive carry full text; TechCrunch and Crunchbase carry it on some items; Silicon Republic has summaries only.
- **Prompt v3:** the user prompt adds the opening after the summary, labelled `Article opening:`, when there is one. The system prompt says `company.name` is the company's own name, never a description such as "startup"; when the title and summary only say "a startup", the name comes from the opening; when no text names the company, the event is left out. The output schema is still `extraction_v2`. Post-processing also counts the opening as source text when it checks that a domain or launch URL appears in the text.
- **Placeholder guard:** `isPlaceholderCompanyName` (`src/pipeline/names/placeholder.ts`) is true for a description rather than a name: "startup", "scale-up", "the company", "platform", "unnamed", "stealth startup", a sector word alone ("fintech", "AI"), only generic and qualifying words ("London-based scale-up"), or an article or capitalised word before a lower-case generic head ("a Manchester startup", "Monzo-backed startup"). Real names keep at least one word that is not generic, so "Startup Genome", "Fintech Farm" and "Platform.sh" pass. A short curated list and two patterns; no special cases for particular names.
- **Retry:** when any event's company name is a placeholder, the item is extracted once more on `EXTRACTION_RETRY_MODEL` (default `gpt-5.6-terra`, which is in the pricing table), through the same budget guard and cap. Both calls are recorded in `llm_usage` as `extraction`. The result with fewer placeholder names becomes the current extraction; on a tie the retry is kept. A budget, price or provider refusal on the retry is handled like any other refusal, so the item stays pending. Any other retry failure keeps the first result. When the retry model is the same as `EXTRACTION_MODEL` there is no retry. The extract stats count `itemsRetried`.
- **Hold:** if a name is still a placeholder, resolve creates no company and no event for that event. It logs `held: placeholder company name (item N)` and counts the event in `resolve.eventsHeldPlaceholder`, shown as "Held: placeholder name" in the hourly summary. Other events in the same item are resolved as usual. An acquisition whose buyer is a placeholder ("a US firm") keeps the buyer text on the event but gets no buyer company. The same guard applies to `reextract` and `reextract --item`, because both resolve through the same code. Grants need no guard: a grant participant is stored only when its registered name ends in a company form or has a registration number (spec-phase2 section 10.3), so it cannot be a bare description.
- **Fixing by hand:** `pnpm ingest reextract --item <id> [--yes]` re-runs the current prompt, with the retry, on one item, makes the result current, resolves it again under the ingest lock, and so moves its event to the right company. Without `--yes` it previews the cost and current names. It is idempotent: an item whose current extraction already uses this prompt and has no placeholder name is skipped, and the same prompt and model are never stored twice. A company left with no events is kept. `pnpm entities rename --type company|investor --id <id> --name "<name>" [--yes]` changes the name, normalised name and slug (a new unique slug, made as for a new entity; a change of case keeps the slug). The old name becomes an alias unless it is a placeholder. The rename is recorded in `entity_merges` with the entity as both sides and a `rename:` note. Nothing derived caches names (search reads `companies.normalised_name` live; themes, stats and sectors key on ids), so nothing is rebuilt. The old slug stops resolving. Both commands, and the existing merge, run from the private repo's manual `fix-data.yml` workflow, which previews unless `confirm` is ticked.
- **Cost:** the opening adds at most about 300 input tokens to an item that has one, about 200 on average, and the longer system prompt about 60 more per call. At `gpt-5.6-luna` prices ($0.20 per million input tokens) that is about $0.05 per 1,000 extracted items. A retry on `gpt-5.6-terra` ($2 input, $12 output per million) costs about $0.006 per item; it happens only for items whose name came back as a placeholder, which is rare. Both fit well within the monthly cap.
- **Not chosen:** fetching article pages (only what the feed carries is used, D68), showing the opening anywhere on the site, a longer opening (the name is almost always in the first sentence), and deleting the alias a placeholder company already has (history is never deleted in code).
