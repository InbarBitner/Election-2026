# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Hebrew (RTL) data platform for the October 2026 Knesset election: poll aggregator, party index, voter-match quiz, ETL pipeline and an automated daily brief. The README is written in Hebrew and is the authoritative design doc. User-facing strings, log messages and workflow step names are in Hebrew too, so keep new ones in Hebrew.

## Commands

Use `python3`/`pip3` locally, never bare `python` (macOS has no `python`, and a failed DB-writing step leaves the site silently stale). CI uses `python` on Ubuntu.

```bash
# Setup
npm install --prefix web
pip3 install -r requirements.txt           # Python 3.11+
cp .env.example web/.env                   # Prisma reads web/.env; default is SQLite at data/election.db
npm run db:push --prefix web               # create/update tables from the Prisma schema

# Populate a fresh DB (the seed deletes and replaces; see the warning under Architecture before re-running it)
python3 -m pipeline.seed                   # add --candidates-per-party 6 for fictional dev candidates
python3 -m pipeline.ml.build_vectors
python3 -m pipeline.brief.generate --date today --no-llm   # --print prints without saving; drop --no-llm to use Claude

# Live ETL (fetches for real, including in --dry-run, which only skips the write)
python3 -m pipeline.run_etl --dry-run
python3 -m pipeline.run_etl

# Official candidate lists (fetches the PDFs; replaces only the named party's candidates)
python3 -m pipeline.load_candidates --dry-run
python3 -m pipeline.load_candidates --party likud

# Web
npm run dev --prefix web                   # http://localhost:3000
npm run test --prefix web                  # vitest, lib/**/*.test.ts only
npm run typecheck --prefix web             # needs `npx prisma generate` first (the client isn't committed)
npm run lint --prefix web
npm run build --prefix web

# Single tests
cd web && npx vitest run lib/seats.test.ts
cd web && npx vitest run -t "threshold"
python3 -m unittest discover -s pipeline -t . -p 'test_*.py' -v      # all pipeline tests (as CI runs them)
python3 -m unittest pipeline.etl.extract.test_wikipedia_polls        # one module

# Diagnostics (Node runs these .ts files directly, with no build step)
cd web && node scripts/poll-stats.ts --window 14 --trend-days 7
cd web && node scripts/house-effects.ts [--json|--stdin]
```

## Architecture

**Python runs offline/batch only, and Next.js is the only runtime.** `pipeline/` writes to the warehouse and `web/` reads from it. No Python service runs in production, and no business logic exists in both languages.

- **The schema has one source of truth: `web/prisma/schema.prisma`.** `pipeline/db.py` reflects the tables at runtime with SQLAlchemy Core and never redeclares them. Adding a column means editing the Prisma schema and running `db push`. The schema is deliberately provider-neutral (no enums, arrays or native types; lists are stored as JSON strings) so moving to Postgres only changes `provider` and `DATABASE_URL`. Two details to watch:
  - Prisma's SQLite stores DateTime as integer epoch milliseconds, so every Python date write must go through `to_db_datetime` in `pipeline/db.py`.
  - A relative `file:` URL resolves against `web/prisma/`. `database_url()` copies that behaviour.
- **The poll maths lives only in TypeScript** (`web/lib/`):
  - `pollAverage.ts` holds the moving average: one poll per firm per day, √n × age-decay weights, and a missing party counts as 0. Only raw polls are stored; the average is computed per request.
  - `houseEffects.ts` holds the shrunk per-firm lean correction.
  - `seats.ts` converts seats to an allocation: 3.25% threshold, Bader-Ofer with surplus agreements, 120 seats exactly.
  - `cosine.ts` powers quiz matching.
  - Every page gets its aggregate through `getPollSnapshot` in `web/lib/queries.ts`, so all pages agree.
  - The Python daily brief **shells out to `node web/scripts/poll-stats.ts`** instead of reimplementing the average. Never add a Python copy of this logic.
- **ETL (`pipeline/run_etl.py`)** runs extract → transform → load per source:
  - Each extractor must report errors and never raise. `_isolate` enforces this, so one failing source only marks the run `partial`.
  - Every run is recorded in `EtlRun`. A source that fetches 0 rows with no error and no `note` is flagged as "silent".
  - Polls come from three sources, in rising precedence: `wikipedia_polls` (strict table acceptance; `(0.7%)` means 0 seats; summary columns such as `Gov.` are rejected), then the configured `polls_scraper`, then `manual_polls.csv`, which wins on the same firm and date.
  - Once real polls load successfully, the demo polls are deleted.
  - Loads are idempotent upserts on natural keys.
- **Don't re-run the seed on a database the ETL has filled.** `clear_seed_data` deletes the seed-provenance `Party` rows, and `PollResult` and `Candidate` cascade from `Party`. So a re-seed wipes the real poll results and the official candidates, and brings the demo polls back. To change parties in a live DB, upsert them with `loader.load_parties` alone.
- **Candidates (`pipeline/load_candidates.py`, `pipeline/etl/extract/candidate_lists.py`)** come from the IDI's PDF copies of the Central Elections Committee's approved lists (`data/sources/candidate_lists.json`). Only places 1–35 are loaded, but the whole list is parsed and validated. A list with a gap, an empty name or Latin letters/digits in a name is not loaded at all. The PDFs are browser prints:
  - pypdf's layout mode returns visual order, so Hebrew and digits come out reversed.
  - Columns can sit only four spaces apart.
  - gov.il's AI-assistant badge and footer can land inside names.
- **Candidate names.** The committee prints family name first, with no marker where it ends.
  - A two-word name is swapped.
  - A longer name is reordered only from `data/sources/candidate_names.json`, which is hand-written. Without an entry it stays in the official order and the load warns.
  - Don't reintroduce automatic splitting: a lexicon-based attempt confidently produced wrong names.
  - The same file holds the owner's corrections, which can differ from the print.
- **Candidate → Knesset links** live in `data/sources/candidate_knesset_links.json`, keyed by the official printed name, and each one was reviewed by hand. A same-name MK from another party, or one long out of office, is left unlinked on purpose. The Knesset ETL loads bills and votes only for linked candidates.
- **Transform rules.** `require_source` in `pipeline/etl/transform/normalize.py` rejects any record missing `sourceUrl`/`sourceName`. Unrecognised party names are reported, never guessed. The fix is to add an alias in `party_mapping.py`.
- **Shared HTTP client (`pipeline/etl/extract/http.py`).** It identifies itself, obeys `robots.txt`, waits 1.5s between requests to the same host, and retries with backoff. Nothing is scraped by default: live sources are opt-in through `data/sources/*.json` (copy the `.example` files and set `"enabled": true`). News is read from RSS only.
- **Knesset connector facts** (measured, not assumed):
  - Votes stop at the 24th Knesset (July 2021). The connector reads that ceiling and records a note rather than returning empty data.
  - Bills come from `ParliamentInfo.svc` and cover the 25th Knesset.
  - OData silently cuts responses at 100 rows, so the connector pages through them.
  - Votes and bills load only for candidates that have `knessetMemberId` set. The ETL fetches for those linked people, whichever Knesset they served in, not for the sitting Knesset.
  - `KNS_Bill.PublicationDate` exists only for bills that became law. Proposals have none. `LastUpdatedDate` is not a bill date: for older bills it is 2021-06-29, the day the records were migrated. So `Bill.date` is nullable, and `knessetNum` plus `year` (taken from the title) place undated bills.
  - Each member keeps their 50 most recent bills (`BILLS_PER_MEMBER`). The query orders by `BillID`, which is only roughly chronological, so the final cut uses date-or-year. The X-ray API orders the same way in code, because ordering by the date column would put every old law above every new proposal.
- **Daily brief (`pipeline/brief/generate.py`)** has two separate stages. Deterministic code first detects the facts. Claude then only phrases those facts and is never the source of one. Without an API key, or if the call fails, a deterministic template writes the brief. The facts are stored alongside the text and shown on `/brief`.
- **Voter match.** `pipeline/ml/vectorize.py` builds 5-axis party vectors: 75% stated positions plus 25% character n-gram TF-IDF. `/api/match` computes cosine similarity with an explanation. Quiz answers are never stored on the server (localStorage only).

## Data-integrity rules enforced on purpose

- **Candidates come only from the official lists.** Never add real or guessed candidate names, or attribute votes or quotes to real politicians in seed or demo data. Fictional dev candidates are labelled as examples.
- Every row carries `provenance` (`seed` | `etl`). While any `seed` row exists, the site shows a demo-data banner.
- Party order comes from the poll average or alphabetical order, never a manual ordering. The "a poll average is not a forecast" disclaimer and each poll's margin of error stay on the page.
- Colour is never the only encoding. 14 parties cannot be told apart by colour alone, so charts show at most 6 series, each with labels and a legend, and every chart has a table alternative. `Party.color`/`colorDark` are a validated categorical palette, not brand colours.

## CI

- `checks.yml` runs on every push and PR:
  - web: typecheck, test, lint, build
  - pipeline: unit tests, `db push`, seed, then a check that a second seed leaves row counts unchanged, `build_vectors`, and the brief with `--no-llm`
  - It deliberately never hits live sources.
- `daily.yml` runs at 04:15 UTC (and manually) and runs the pipeline against live sources.
- `probe-*.yml` are manual workflows that print the real response shapes of the Knesset and Wikipedia sources (the dev sandbox can't reach them). Write connectors against observed responses, not assumed ones.
