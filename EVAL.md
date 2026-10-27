# Itemized eval

Produced by `npm run eval` (`test/eval/run.mjs`). Machine-readable results for the public sets are in `test/eval/results.json`.

## Results

| Set | Model | n | Fields | Disclosures | Verdict agreement | False fails | Missed fails | Fail to review | Review rate | Checks not run | Cost per review, mean / p90 | Model time per review, mean / p90 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a. Synthetic PDFs | Muse Spark 1.3 (Meta Model API) | 12 | 1087/1088 | 95/96 | 514/516 (99.6%) | 0 | 0 | 1 | 2.3% | 0 | $0.0324 / $0.0374 | 20.1 s / 26.1 s |
| b. Synthetic photos | Muse Spark 1.3 (Meta Model API) | 4 | 344/356 | 32/32 | 166/172 (96.5%) | 0 | 0 | 5 | 7.0% | 0 | $0.0357 / $0.0384 | 13.5 s / 14.8 s |
| c. Synthetic photos | Muse Spark Open (Baseten) | 4 | 344/356 | 32/32 | 167/172 (97.1%) | 0 | 0 | 5 | 6.4% | 0 | $0.0299 / $0.0316 | 24.6 s / 28.1 s |
| d. Synthetic PDFs as page images | Muse Spark Open (Baseten) | 12 | 1083/1088 | 95/96 | 497/516 (96.3%) | 0 | 1 | 17 | 5.4% | 0 | $0.0270 / $0.0313 | 19.2 s / 21.1 s |
| d. Same extraction, PDF rules (diagnostic) | Muse Spark Open (Baseten) | 12 | 1083/1088 | 95/96 | 514/516 (99.6%) | 0 | 1 | 0 | 2.1% | 0 | $0.0270 / $0.0313 | 19.2 s / 21.1 s |
| e. FTC Sample 1 template | Muse Spark 1.3 (Meta Model API) | 1 | n/a | n/a | 43/43 (100.0%) | 0 | 0 | 0 | 7.0% | 0 | $0.0310 / $0.0310 | 20.5 s / 20.5 s |

## Real price lists (aggregates only)

12 redacted real General Price Lists ran on Muse Spark Open through Baseten, as page images. A list with more pages than the provider takes in one request (8 images) is read in batches of pages and merged. No real list was sent to the Meta Model API.

| Measure | Value |
|---|---|
| Lists run | 12 |
| Verdicts (fail / review / pass / not applicable) | 0 / 99 / 365 / 52 |
| Fails per list, mean | 0.0 |
| Review rate | 19.2% |
| Checks not run | 0 |
| Name, address or phone checks counted as pass because the element was redacted | 30 |
| Hand-labeled list: verdict agreement | 39/43 |
| Hand-labeled list: false fails / missed fails / fail to review | 0 / 0 / 4 |
| Same extractions under the PDF rules (diagnostic): fails, and lists with at least one | 19, 7 of 12 |
| Hand-labeled list under the PDF rules: agreement; false fails / missed fails | 41/43; 0 / 0 |
| Cost per review, mean / p90 | $0.0661 / $0.1054 |
| Model time per review, mean / p90 | 47.8 s / 69.1 s |

## Run-to-run variance

The main table runs each document once, so it cannot show how much a fresh extraction moves between runs. To measure that, syn-03 was extracted five times per model with the cache bypassed (`test/eval/extraction-variance.mjs`, raw runs in `test/eval/variance/`). Muse Spark 1.3 read the PDF, as in set a. Muse Spark Open read the rendered page image, as in set d. Each run was scored against the list's ground truth and put through the deterministic checks under both the photo rule and the PDF rule. The 13 semantic checks were not run, so 30 checks are compared.

| Measure, 5 runs each | Muse Spark 1.3 (PDF) | Muse Spark Open (page image) |
|---|---|---|
| Fields right, per run | 86/86 in all five | 86, 83, 86, 85, 85 of 86 |
| Disclosures right, per run | 8/8 in all five | 8/8 in all five |
| Disclosure blocks found, per run | 5 in all five | 5 in all five |
| Disclosure match status (present, altered, absent) | identical in all five | identical in all five |
| Items found, per run | 25 in all five | 25 in all five |
| Checks where all five verdicts agree, photo rule | 30 of 30 | 30 of 30 |
| Checks where all five verdicts agree, PDF rule | 30 of 30 | 30 of 30 |
| Distinct extractions out of 5 | 2 | 5 |
| Cost per extraction, range | $0.0112 to $0.0190 | $0.0089 to $0.0128 |
| Model time per extraction, range | 11.3 s to 13.8 s | 12.1 s to 13.8 s |

No verdict moved on this list for either model. What varied was the transcription. On Muse Spark 1.3 the only difference was the order of two disclosure blocks in one run. On Muse Spark Open, the provider name came back with an extra letter in two runs, and in one run an item was dropped and replaced by a misspelled duplicate. Those slips changed a field score but not a check, because the disclosure statements and prices the checks read came through intact. This is one short synthetic list with a single page, so it shows that the extraction is stable here, not that it is stable on every list. Rarer drops of whole statements need more lists and more runs to size.

The variance runs are repeated with `node test/eval/extraction-variance.mjs --list syn-03 --provider <meta-api|open-weights> --base <local Worker URL>` against a local `wrangler dev` started with `--var DEV_ROUTES:1` and the matching `MODEL_PROVIDER`. The driver refuses real-list files unless the Worker runs open-weights.


## Off-label verdicts in the public sets

a. Synthetic PDFs, meta-api:
- syn-07 C-060 (fail to review: expected fail, got review)
- syn-07 C-061 (other: expected pass, got review)

b. Synthetic photos, meta-api:
- syn-03 C-030 (fail to review: expected fail, got review)
- syn-03 C-041 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)
- syn-03 C-007 (other: expected pass, got review)

c. Synthetic photos, open-weights:
- syn-03 C-030 (fail to review: expected fail, got review)
- syn-03 C-041 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)

d. Synthetic PDFs as page images, open-weights:
- syn-07 C-060 (missed fail: expected fail, got pass)
- syn-03 C-030 (fail to review: expected fail, got review)
- syn-03 C-041 (fail to review: expected fail, got review)
- syn-04 C-020 (fail to review: expected fail, got review)
- syn-04 C-044 (fail to review: expected fail, got review)
- syn-05 C-040 (fail to review: expected fail, got review)
- syn-05 C-050 (fail to review: expected fail, got review)
- syn-06 C-002 (fail to review: expected fail, got review)
- syn-06 C-072 (fail to review: expected fail, got review)
- syn-06 C-073 (fail to review: expected fail, got review)
- syn-07 C-003 (fail to review: expected fail, got review)
- syn-07 C-005 (fail to review: expected fail, got review)
- syn-08 C-061 (fail to review: expected fail, got review)
- syn-08 C-070 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)
- syn-11 C-004 (fail to review: expected fail, got review)
- syn-07 C-061 (other: expected pass, got review)

d. Same extraction, PDF rules (diagnostic), open-weights:
- syn-07 C-060 (missed fail: expected fail, got pass)
- syn-07 C-061 (other: expected pass, got review)

e. FTC Sample 1 template, meta-api: none.

## Method

- Every set goes through the local Worker the same way an upload does: store, queue, extract, semantic checks, rules engine. The harness then asks a development route for the engine verdicts on the cached extraction, with the audit date fixed at 2026-10-26 so the stale-date check does not drift between runs.
- Fields and disclosures score the extraction against ground truth parsed from the synthetic lists' HTML sources (`test/eval-extraction.mjs`). The FTC template and the real lists have no field-level ground truth.
- Verdicts are compared per check with `prep/synthetic/labels.json`, `specimens/labels.json` (checks it does not list are expected to pass) and the hand labels for one real list. A check with several findings counts as its most severe verdict. Agreement means the verdict is the label or one of its `also_ok` alternatives. A false fail is a fail the label does not allow. A missed fail is a labeled fail that came back pass or not applicable. Fail to review is a labeled fail that came back review, which is the intended result on photos whenever a misread could explain the fail.
- Review rate is reviews divided by checks run. Checks not run are semantic checks whose model step was skipped.
- Photo and page-image sets run with the photo rule (engine input `images`). Set d also shows the same extraction under the PDF rules, so the true fails the photo rule turns into reviews are visible.
- Page images for sets d and the real lists are rendered at 150 DPI, 8-bit grayscale, with PDFKit (`test/eval/render-pages.swift`), outside the Worker.
- Verdicts come from rules engine version `engine-5`.
- Cost and model time per review are the extraction call plus the semantic call that produced each cached result, read from the local `model_calls` table. Each document ran once (n=1 per document and model). The numbers carry sampling noise that a single run cannot show.
- Real price lists ran only on Muse Spark Open through Baseten. The harness refuses any real-list file unless the running Worker reports the open-weights provider, and a test asserts that rule. Per-list results stay in a private, gitignored folder; this file carries aggregates only.

## Rerun

On the machine that produced these numbers:

```
npm run eval
```

It starts `wrangler dev -c wrangler.production.jsonc` itself (local state only, nothing deployed), once per provider, with development routes on, and reads the cached extractions, semantic results and rendered page images, so it costs nothing. From a fresh checkout, with keys in `.dev.vars`, use the portable configuration instead. It makes new model calls:

```
npx wrangler d1 migrations apply DB --local
node test/eval/run.mjs --sets a,b,c,d,e
```

Spend is capped per run at $1 on the Meta Model API and $4 on Baseten (`--cap-meta-api`, `--cap-open-weights`). Set f needs the private corpus, so leave it out of `--sets` elsewhere.

This run spent $0.0000 on the Meta Model API and $0.4196 on Baseten.
