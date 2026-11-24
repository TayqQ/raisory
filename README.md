<p align="center">
  <a href="https://raisory.vercel.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/design/brand/logo/raisory-lockup-dark.svg">
      <img src="docs/design/brand/logo/raisory-lockup.svg" alt="Raisory" width="260">
    </picture>
  </a>
</p>

<p align="center">
  <strong>Who's raising in UK and European tech, checked against official records and linked to the source.</strong>
</p>

<p align="center">
  <a href="https://raisory.vercel.app"><strong>raisory.vercel.app</strong></a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#engineering">Engineering</a>
</p>

<p align="center">
  <a href="https://github.com/TayqQ/raisory/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/TayqQ/raisory/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Tests: 2,082" src="https://img.shields.io/badge/tests-2%2C082-1D49A9">
  <img alt="AI spend: under £1 a month" src="https://img.shields.io/badge/AI%20spend-under%20%C2%A31%2Fmonth-E95D10">
  <a href="LICENSE"><img alt="Licence: AGPL-3.0" src="https://img.shields.io/badge/licence-AGPL--3.0-0E1C3B"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">
  <img src="docs/images/hero-light.png" alt="The Raisory funding page: a summary panel of the money raised in the last 30 days, by sector and biggest rounds, above a list of recent seed and Series A rounds">
</picture>

## What Raisory is

Startup funding news is scattered across a dozen outlets, often repeated, and rarely checked. Raisory reads that news every hour and pulls out the facts of each round: who raised, how much, at what stage, from whom and where. It merges duplicate reports into one record, then checks each company against **Companies House**, **UKRI grant records** and **SEC filings**. Every figure links back to the articles it came from.

It's built for two kinds of people:

- **Market readers** (founders, investors, the curious) who want to see where the money is going this week, by sector, stage and place.
- **People who sell to startups** (agencies, recruiters, B2B teams) who want a short, current list of companies that have just raised, with the facts they need to act.

### What you can do with it

- **Scan the market.** See how much was raised and the median round, which sectors are busiest and the biggest rounds, over the last 7 days, 30 days, 90 days or 12 months, for any filter.
- **Filter properly.** Search, then filter by sector (ranked by recent activity), stage, deal size, date, place and "confirmed by an official filing". Every filter is a shareable URL.
- **Work the way you like.** Use a dense list with keyboard navigation (`j` / `k`), or cards. The site remembers your choice.
- **Trust what you read.** Company pages show the latest round with its proof ("Shares allotted on 2 October 2026, Companies House SH01"), the funding history, the investors, plain-English signals and the official registry facts.
- **Use it anywhere.** It has light and dark themes, a phone layout with a bottom tab bar, and the core filters work without JavaScript.

## A quick tour

<table>
  <tr>
    <td width="60%"><img src="docs/images/company-dark.png" alt="A company page in dark mode: the header with actions, key facts, the latest round confirmed by a Companies House filing, signals and official records"></td>
    <td width="40%"><img src="docs/images/mobile-company-light.png" alt="The same company page on a phone"></td>
  </tr>
  <tr>
    <td><img src="docs/images/cards-light.png" alt="The funding list in card view, with sector and stage chips and the amounts raised"></td>
    <td><img src="docs/images/mobile-home-dark.png" alt="The funding summary on a phone in dark mode"></td>
  </tr>
</table>

## By the numbers

As of 20 November 2026, about six weeks after work started:

|                                        |                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Funding records                        | **3,047** (rounds from news, plus UKRI grants)                                                           |
| Companies                              | **2,373**, of which **1,667** are matched to Companies House                                             |
| Rounds confirmed by an official filing | **19**, plus **146** US Form D filings indexed                                                           |
| Sources                                | 9: six news feeds (all checked against robots.txt), UKRI Gateway to Research, Companies House, SEC EDGAR |
| AI spend since launch                  | **$0.56** across 452 model calls, under a hard monthly cap                                               |
| Hosting                                | £0 (Vercel, Neon and GitHub Actions free tiers)                                                          |
| Automated tests                        | **2,082**, run against a real Postgres engine                                                            |

## How it works

```mermaid
flowchart LR
  subgraph Sources
    N[News RSS<br/>robots.txt checked]
    G[UKRI grants]
    CH[Companies House]
    E[SEC EDGAR]
    FX[ECB rates]
  end
  subgraph Pipeline[GitHub Actions]
    direction LR
    C[Collect] --> P[Keyword prefilter] --> X[LLM extraction<br/>budget guard] --> R[Resolve and merge] --> L[Link and confirm<br/>with registries]
    L --> D[Derived views<br/>sectors, themes, stats]
  end
  N --> C
  G --> R
  CH --> L
  E --> L
  FX --> R
  D --> DB[(Postgres<br/>Neon)]
  DB -- read-only role --> W[Next.js on Vercel]
  W --> U[Readers]
```

- **Hourly** (news): collect, keyword prefilter, one model call per likely story, merge into companies, investors and events, convert currencies, then rebuild the cheap derived views. Each run takes about a minute and every step is timed.
- **Daily** (records): UKRI grants, enrichment (tags, embeddings, themes), Companies House linking and confirmation, and SEC Form D. Each step has its own time limit, so one slow source can't stall the rest.

## Engineering

The interesting problems here aren't the UI. They're precision, cost and trust.

- **The model finds, code computes.** The LLM returns amounts as verbatim text, and tested code parses them. Links and domains are kept only if they appear in the source. Every output is validated against a schema.
- **Events are derived, not stored.** Each round is rebuilt from all its reports, so arrival order doesn't matter and new evidence corrects old values.
- **Wrong merges are worse than missed ones.** Companies merge, and registry links are made automatically, only on strong evidence. Anything else goes to a review queue. On 72 hand-labelled linking cases, it made **0 wrong automatic links** (90% recall).
- **Measured, not assumed.** Evals cover extraction, entity merging, registry linking and theme clustering. They're small, deliberately hard sets, and their results are committed in `docs/`. The production model meets every extraction target on the current set.
- **Cost is engineered, not hoped for.** A keyword prefilter decides what reaches the model. Every call is priced against a hard monthly cap before it's made, unknown model prices are refused, and provider credit is prepaid. Visitors can never trigger spend.
- **A good citizen of the web.** Publisher fetches follow robots.txt (RFC 9309, stricter where a site refuses us its rules), conditional requests, per-host spacing and a contact address in the user agent. We show headlines and links, never article text.
- **No personal data.** Records are company-level only. People's names and contact details aren't stored.
- **Product craft.**
  - **Design system:** a small set of shared tokens and primitives, with light and dark themes whose contrast is enforced by tests.
  - **Responsive app shell:** a sidebar on desktop, an icon rail on laptops and bottom tabs on phones.
  - **Accessibility:** a keyboard-friendly list, stage labels whose contrast is tested in both themes, and filters that are plain GET forms, so shared URLs and no-JavaScript visits work.
- **Decisions are written down.** 60+ architecture decisions in [`docs/decisions.md`](docs/decisions.md), and 80+ scoped task specs in [`docs/tasks/`](docs/tasks) that each change was built and reviewed against.

**Stack:** TypeScript, Next.js 16 (App Router), React 19, Tailwind CSS 4, Postgres on Neon with Drizzle ORM and pgvector, Zod, the OpenAI API, GitHub Actions, Vercel, Vitest and PGlite.

## Run it locally

You need Node 24, pnpm and Docker.

```bash
pnpm install
```

```bash
docker run -d --name raisory-pg -e POSTGRES_USER=raisory -e POSTGRES_PASSWORD=raisory -e POSTGRES_DB=raisory -p 127.0.0.1:5432:5432 pgvector/pgvector:pg17
```

Copy `.env.example` to `.env`. Set `DATABASE_URL` to `postgres://raisory:raisory@localhost:5432/raisory`, and `HTTP_CONTACT` to an email address where publishers can reach you.

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm dev
```

`pnpm db:seed` loads invented sample data. To collect real feeds instead, start from a fresh database and run `pnpm ingest run`; no API key is needed to collect. `pnpm check` runs lint, formatting, types and the tests. Deployment is covered in [`docs/deployment.md`](docs/deployment.md).

## Limitations

- **Coverage follows the sources.** Three major European feeds currently can't be read: one blocks cloud servers, and two disallow automated reading. Permission has been requested. Coverage leans towards English-language, well-reported startups.
- **Amounts are as reported** unless an official filing confirms them, and confirmations exist only for UK companies whose filings we can match.
- **History starts in October 2026**, because news feeds don't go back in time.
- **The evals are small** and over-represent hard cases. They guard against regressions; they aren't a measure of live accuracy.

## Data and attribution

Raisory shows headlines, links and extracted facts, always credited to the source. Feed summaries go to the language model and are never displayed. Publisher terms and robots rules are reviewed for every source; see [`docs/sources.md`](docs/sources.md).

## About

Designed and built by **Taylor Hallin** ([taylorhallin.com](https://taylorhallin.com)) as an independent product.

Taylor set the product direction, the design and the priorities. The work was planned as small, scoped tasks with written acceptance criteria, and much of the implementation was done by AI coding agents working from those specs. Every change had to meet its criteria and pass the full test suite before it merged. The task specs and the decisions behind the build are in [`docs/`](docs).

## Licence

[AGPL-3.0](LICENSE).
