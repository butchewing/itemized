# Provenance: what existed before the hackathon

The Meta Global AI Developer Hackathon rules require that judges can tell what was built during the event (Oct 26 – Nov 4, 2026). This file lists everything in the repo that predates kickoff. All other code was written during the event, and the git history shows when.

**No application code existed before kickoff.** Nothing here runs the product: no Worker, no extraction, no rules engine, no UI.

## Pre-event material (data, specs and test fixtures)

| Path | Created | What it is |
|---|---|---|
| `prep/rules/ftc-453@2026.1.json` | 2026-10-20 | Draft ruleset: Funeral Rule (16 CFR 453) disclosures, items and checks transcribed into JSON. The engine that runs it is built during the event |
| `prep/synthetic/pdf/`, `labels.json` | 2026-10-20 | 12 synthetic General Price Lists for fictional providers, with expected findings |
| `prep/synthetic/photos/` | 2026-10-21 | Phone photos of printed synthetic lists (demo inputs), metadata stripped |
| `specimens/ftc-sample1-gpl-template.pdf` | 2026-10-20 | FTC Sample 1 GPL, extracted from the FTC's *Complying with the Funeral Rule* (public US government work) |
| `specimens/labels.json` | 2026-10-20 | Hand-labeled expected findings for the FTC template |

A private build plan (2026-10-20) and the generator script for the synthetic lists also predate the event. Neither is in this repo.

## Built during the event

Everything else, including the Worker, ingestion, Meta model integration, ruleset compiler and engine, semantic checks, report UI and eval harness.

## Not in this repo

A private evaluation set of real funeral home price lists stays outside version control. Only aggregate accuracy numbers from it are published.
