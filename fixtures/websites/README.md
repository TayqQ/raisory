# Website verification eval fixtures

`cases.json` holds labelled cases for the website verification rules (D64, `src/pipeline/websites/rules.ts`). `pnpm eval --websites` replays them through the rules, the LLM check (`llm-check.ts`) and the website store (`website-store.ts`) on an in-memory database, with no network and no cost, and prints the results. A test (`src/eval/websites.test.ts`) requires no wrong automatic link. Recall is reported with no threshold. `heads/` holds saved `<head>` snippets for the icon candidate tests in `src/pipeline/websites/fetch-page.test.ts`.

> **Labels checked by the maintainer on 23 November 2026.** The labels and reasons were prepared by Claude. The maintainer checked the cases from real homepages and corrected web-19, web-24, web-26, web-27 and web-28.

> **LLM answers are hand-written stand-ins.** Each case that reaches the LLM check (rule W3) carries a recorded answer in `llm`, marked `"recorded": "hand-written stand-in"`. They are plausible strict-schema answers (`same`, `different` or `unsure`), written by hand, until the maintainer's live run replaces them: `pnpm eval --websites --live` (needs `OPENAI_API_KEY`, capped at $0.05) asks `gpt-5.6-luna` for every case that needs it and writes its answers back with the model and date. Run `pnpm format` afterwards. Cases recorded as `over_budget` or `invalid` keep that answer, because they test the refusal paths.

## What a case holds

- **Company:** real company facts already public on the site (name, country, city, description), with the company's id for reference. `linkedCompanyNumber` is the company's Companies House number, where it has one. Some cases add an alias.
- **Source:** where the domain came from (`article`, `ukri`, `name` or `guess`).
- **Page:** a page summary as `fetch-page.ts` returns it, reduced to the title, `og:site_name`, `og:title`, the meta description and a short footer snippet, plus the company numbers found next to a cue. No person's name, email address or phone number is kept; footers are abridged.
  - `"pageFrom": "fetched"`: read from the real homepage on 23 November 2026 with one polite request (robots.txt checked first, the Raisory user agent). Footers are abridged.
  - `"pageFrom": "hand-written"`: written by hand to test a pattern. These use the reserved `.example` domain (RFC 2606), so they never describe a real site, except where the host itself is what the case tests (a news, data, social, accelerator, app store, link-in-bio or parking host).
- **Holder and existing rows:** another company or an investor that already holds the domain, and rows the company already has (for example a manual rejection). The eval seeds them before the case runs. Each case runs in its own transaction, rolled back afterwards.
- **Expected:** the status a careful person would give the domain with the same facts. `linked` only when they would be sure; `candidate` when it is worth a look; `rejected` otherwise. A page that could not be read is labelled `rejected` (not read, so not linked this run). The label says what is true, not what the rules do: a correct link that the rules send to review stays labelled `linked` and counts against recall.

## Choices the cases test

Choices in D64 that each have a case:

- **Title separators** include `/` and `\` between spaces, and `:` only before a space, so "Home \ Anthropic" matches (web-11) while "21:12 Communications" and "Optimise-AI" stay whole (web-61).
- **A redirect away from a stated domain** loses W2: the article vouched for the old domain, not the new one, so the LLM check decides (web-51). With a short name it goes to review (C2).
- **An investor's website** is rejected like a news or social host (web-38). A domain held by another company goes to review (X3, web-48, web-49).
- **X2** applies when none of the numbers on the page is the company's own (web-52, web-53). A page showing the company's number among others is W1.
- **An unread page on a stated domain** goes to review (C2), because the source vouched for it (web-24). On a guessed domain it is rejected (web-25).
- **A bare domain that fails** is retried once at `www.` (web-26). **GoDaddy's holding page** counts as parked (web-27, web-28).
- **A re-check that cannot read the page** leaves an automatic link (or candidate) in place (web-60). A re-check that finds the page parked demotes it (web-59).

## Changing cases

Do not edit a label to raise the score. If a case fails, fix a rule, keep the case, and note the change here. If a label is wrong, say why in the commit. A wrong automatic link found on the live site becomes a new case.

## Cases

| Case   | Company                | Domain (after redirects) | Expected  | Page         | Reason                                                                         |
| ------ | ---------------------- | ------------------------ | --------- | ------------ | ------------------------------------------------------------------------------ |
| web-01 | Payhawk                | payhawk.com              | linked    | fetched      | Spend management platform, title ends "Payhawk"; matches the description       |
| web-02 | Mistral                | mistral.ai               | linked    | fetched      | French frontier AI lab; og:site_name "Mistral"                                 |
| web-03 | Bending Spoons         | bendingspoons.com        | linked    | fetched      | Milan company that acquires digital products; og:site_name matches             |
| web-04 | Isomorphic Labs        | isomorphiclabs.com       | linked    | fetched      | AI drug discovery; title part "Isomorphic Labs"                                |
| web-05 | Fresha                 | fresha.com               | linked    | fetched      | Salon booking platform for beauty and wellness businesses; title part "Fresha" |
| web-06 | Taalas                 | taalas.com               | linked    | fetched      | Turns models into custom silicon; og:site_name "Taalas"                        |
| web-07 | Gradyent               | gradyent.ai              | linked    | fetched      | Digital twin for heating grids; title part "Gradyent"                          |
| web-08 | Hone Health            | honehealth.com           | linked    | fetched      | Longevity telehealth clinic; og:site_name "Hone Health"                        |
| web-09 | Model ML               | modelml.com              | linked    | fetched      | AI agents for finance; title is exactly "Model ML"                             |
| web-10 | Ranketta               | ranketta.com             | linked    | fetched      | Tracks products in AI recommendations; og:site_name "Ranketta"                 |
| web-11 | Anthropic              | anthropic.com            | linked    | fetched      | AI safety company behind Claude; title part "Anthropic"                        |
| web-12 | Commit Biologics       | commitbio.com            | linked    | fetched      | Redirects to commitbio.com, a Copenhagen biotech with the same name            |
| web-13 | etiCloud               | everythingthatis.cloud   | linked    | fetched      | Redirects to everythingthatis.cloud; etiCloud Ltd, Sheffield, as described     |
| web-14 | NCIMB LIMITED          | ncimb.com                | linked    | fetched      | Footer shows SC078368, the company's own number                                |
| web-15 | TAPOLY LTD             | tapoly.com               | linked    | fetched      | Footer shows 10340563, the company's own number                                |
| web-16 | P2PANDA LTD            | p2panda.org              | linked    | fetched      | UKRI website; title "p2panda" is the company name                              |
| web-17 | Science                | science.xyz              | linked    | fetched      | Article domain; brain-computer interface company, title part "Science"         |
| web-18 | Disseqt AI             | disseqt.ai               | linked    | fetched      | AI assurance platform, footer "DISSEQT AI LIMITED"; title says only "Disseqt"  |
| web-19 | PAXMAN COOLERS LIMITED | paxmangroup.com          | linked    | fetched      | Paxman scalp cooling for chemo side effects; no "Coolers" or number, so review |
| web-20 | Imprint                | imprint.co               | candidate | fetched      | Name matches but our facts say nothing of the business                         |
| web-21 | Archer                 | archer.com               | rejected  | fetched      | Aerospace company; ours is AI recruiting                                       |
| web-22 | Playbook               | playbook.com             | rejected  | fetched      | US file-storage product; ours is pharma document AI in Munich                  |
| web-23 | Speakeasy              | speakeasy.com            | rejected  | fetched      | Enterprise AI governance; ours is in-real-life economy infrastructure          |
| web-24 | Quantum Systems        | quantum-systems.com      | linked    | fetched      | Drone company from the article; site answers 403, so review                    |
| web-25 | Acorda                 | acorda.com               | rejected  | fetched      | robots.txt unavailable; never fetched                                          |
| web-26 | MIND FOUNDRY LIMITED   | mindfoundry.ai           | linked    | fetched      | Bare domain redirects to a 404; www answers, title "Mind Foundry"              |
| web-27 | NOWDOCTOR LTD.         | nowdoctor.co.uk          | rejected  | fetched      | GoDaddy holding page (script to /lander): parked                               |
| web-28 | KELTIC PHARMA LIMITED  | kelticpharma.com         | rejected  | fetched      | GoDaddy holding page (script to /lander): parked                               |
| web-29 | Treat                  | treat.example            | rejected  | hand-written | US dog treats; ours is Helsinki healthcare AI                                  |
| web-30 | Iconic                 | iconic.example           | rejected  | hand-written | Amsterdam hair salon; ours builds software for capital projects                |
| web-31 | Wilco                  | wilco.example            | candidate | hand-written | Name matches; the page says too little to tell                                 |
| web-32 | LATO                   | lato.example             | rejected  | hand-written | Brazilian accounting AI; ours does due diligence calls in Warsaw               |
| web-33 | MountAIn               | mountain.example         | rejected  | hand-written | Outdoor clothing shop; ours is AI on microcontrollers                          |
| web-34 | BCD STUDIO LTD.        | bcd.example              | rejected  | hand-written | Only the 3-letter alias "BCD" matches; guessed domain                          |
| web-35 | Genesis AI             | robotics.example         | rejected  | hand-written | Only the generic alias "Robotics" matches                                      |
| web-36 | BCD STUDIO LTD.        | bcd-studio.example       | linked    | hand-written | Article domain; design studio, footer "BCD Studio Ltd"                         |
| web-37 | Wilgot                 | sifted.eu                | rejected  | hand-written | News publisher                                                                 |
| web-38 | HoloSolis              | harbourlane.example      | rejected  | hand-written | An investor's website                                                          |
| web-39 | CoProd                 | ycombinator.com          | rejected  | hand-written | Accelerator host                                                               |
| web-40 | Legacy Locker          | linktr.ee                | rejected  | hand-written | Link-in-bio host                                                               |
| web-41 | Gotmoves               | apple.com                | rejected  | hand-written | App store link (apps.apple.com)                                                |
| web-42 | Tesorai                | crunchbase.com           | rejected  | hand-written | Company database                                                               |
| web-43 | End Close              | linkedin.com             | rejected  | hand-written | Social network                                                                 |
| web-44 | Asynchronics           | asynchronics.notion.site | rejected  | hand-written | Notion page, not a company site                                                |
| web-45 | Vetaion                | vetaion.example          | rejected  | hand-written | Domain for sale                                                                |
| web-46 | Occam Industries       | sedo.com                 | rejected  | hand-written | Redirects to a domain marketplace                                              |
| web-47 | IntelliProve           | intelliprove.example     | rejected  | hand-written | Not HTML                                                                       |
| web-48 | Phemly                 | ranketta.com             | candidate | hand-written | Redirects to its acquirer, which holds ranketta.com                            |
| web-49 | Theseus Robotics       | theseusrobotics.example  | candidate | hand-written | Domain held by another company record ("Theseus")                              |
| web-50 | Agon                   | agonvalves.example       | rejected  | hand-written | Redirects to a valve maker                                                     |
| web-51 | Hoplite                | hoplitehq.example        | linked    | hand-written | Rebrand redirect; speeds up agents, as described                               |
| web-52 | Clarity Sensors        | claritysensors.example   | rejected  | hand-written | Footer number 07654321 is not the company's 14120836                           |
| web-53 | RETHREAD DENIM LTD     | rethreaddenim.example    | rejected  | hand-written | Reseller's number 09123456 is not the company's 15531303                       |
| web-54 | Wilgot                 | wilgot.example           | rejected  | hand-written | Building firm Wilgot Bygg AB; ours is agentic commerce                         |
| web-55 | Fermat                 | fermat.example           | linked    | hand-written | Fashion design and production AI, Barcelona, as described                      |
| web-56 | Previsia               | previsia.example         | linked    | hand-written | AI risk prevention for insurers, Toulouse, as described                        |
| web-57 | Perry AI               | perry.example            | rejected  | hand-written | Rejected by hand earlier; stays rejected                                       |
| web-58 | Pretxt                 | pretxt-ai.example        | candidate | hand-written | Already linked to pretxt.example; a person picks one                           |
| web-59 | Alecto                 | alecto.example           | rejected  | hand-written | Re-check: now parked                                                           |
| web-60 | CABLE COATINGS LIMITED | cablecoatings.example    | linked    | hand-written | Re-check blocked; the earlier link stands                                      |
| web-61 | OPTIMISE-AI LTD        | optimise-ai.example      | linked    | hand-written | UKRI website; title part "Optimise-AI"                                         |
