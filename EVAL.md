# Itemized eval

Produced by `npm run eval` (`test/eval/run.mjs`). Machine-readable results for the public sets are in `test/eval/results.json`.

## Results

| Set | Model | n | Fields | Disclosures | Verdict agreement | False fails | Missed fails | Fail to review | Review rate | Checks not run | Cost per review, mean / p90 | Model time per review, mean / p90 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a. Synthetic PDFs | Muse Spark 1.3 (Meta Model API) | 12 | 1087/1088 | 95/96 | 515/516 (99.8%) | 0 | 0 | 0 | 2.1% | 0 | $0.0327 / $0.0363 | 23.9 s / 28.0 s |
| b. Synthetic photos | Muse Spark 1.3 (Meta Model API) | 4 | 346/356 | 30/32 | 163/172 (94.8%) | 0 | 0 | 5 | 8.7% | 0 | $0.0371 / $0.0429 | 24.2 s / 27.3 s |
| c. Synthetic photos | Muse Spark Open (Baseten) | 4 | 346/356 | 31/32 | 165/172 (95.9%) | 0 | 0 | 5 | 7.6% | 0 | $0.0315 / $0.0349 | 32.1 s / 38.7 s |
| d. Synthetic PDFs as page images | Muse Spark Open (Baseten) | 12 | 1079/1088 | 95/96 | 497/516 (96.3%) | 0 | 0 | 18 | 5.6% | 0 | $0.0280 / $0.0304 | 19.4 s / 20.7 s |
| d. Same extraction, PDF rules (diagnostic) | Muse Spark Open (Baseten) | 12 | 1079/1088 | 95/96 | 515/516 (99.8%) | 0 | 0 | 0 | 2.1% | 0 | $0.0280 / $0.0304 | 19.4 s / 20.7 s |
| e. FTC Sample 1 template | Muse Spark 1.3 (Meta Model API) | 1 | n/a | n/a | 43/43 (100.0%) | 0 | 0 | 0 | 7.0% | 0 | $0.0286 / $0.0286 | 24.4 s / 24.4 s |

## Real price lists (aggregates only)

9 redacted real General Price Lists ran on Muse Spark Open through Baseten, as page images. 3 more have more than 8 pages and were not run, because the open-weights provider takes at most 8 images per request. No real list was sent to the Meta Model API.

| Measure | Value |
|---|---|
| Lists run | 9 |
| Verdicts (fail / review / pass / not applicable) | 0 / 76 / 275 / 36 |
| Fails per list, mean | 0.0 |
| Review rate | 19.6% |
| Checks not run | 0 |
| Name, address or phone checks counted as pass because the element was redacted | 21 |
| Hand-labeled list: verdict agreement | 39/43 |
| Hand-labeled list: false fails / missed fails / fail to review | 0 / 0 / 4 |
| Same extractions under the PDF rules (diagnostic): fails, and lists with at least one | 23, 6 of 9 |
| Hand-labeled list under the PDF rules: agreement; false fails / missed fails | 41/43; 0 / 0 |
| Cost per review, mean / p90 | $0.0617 / $0.0918 |
| Model time per review, mean / p90 | 41.6 s / 55.2 s |

## Off-label verdicts in the public sets

a. Synthetic PDFs, meta-api:
- syn-07 C-061 (other: expected pass, got review)

b. Synthetic photos, meta-api:
- syn-03 C-030 (fail to review: expected fail, got review)
- syn-03 C-041 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)
- syn-03 C-007 (other: expected pass, got review)
- syn-03 C-061 (other: expected pass, got review)
- syn-03 C-072 (other: expected pass, got review)
- syn-03 C-073 (other: expected pass, got review)

c. Synthetic photos, open-weights:
- syn-03 C-030 (fail to review: expected fail, got review)
- syn-03 C-041 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)
- syn-03 C-007 (other: expected pass, got review)
- syn-10 C-074 (other: expected not_applicable, got review)

d. Synthetic PDFs as page images, open-weights:
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
- syn-07 C-060 (fail to review: expected fail, got review)
- syn-08 C-061 (fail to review: expected fail, got review)
- syn-08 C-070 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)
- syn-11 C-004 (fail to review: expected fail, got review)
- syn-07 C-061 (other: expected pass, got review)

d. Same extraction, PDF rules (diagnostic), open-weights:
- syn-07 C-061 (other: expected pass, got review)

e. FTC Sample 1 template, meta-api: none.

## Method

- Every set goes through the local Worker the same way an upload does: store, queue, extract, semantic checks, rules engine. The harness then asks a development route for the engine verdicts on the cached extraction, with the audit date fixed at 2026-10-26 so the stale-date check does not drift between runs.
- Fields and disclosures score the extraction against ground truth parsed from the synthetic lists' HTML sources (`test/eval-extraction.mjs`). The FTC template and the real lists have no field-level ground truth.
- Verdicts are compared per check with `prep/synthetic/labels.json`, `specimens/labels.json` (checks it does not list are expected to pass) and the hand labels for one real list. A check with several findings counts as its most severe verdict. Agreement means the verdict is the label or one of its `also_ok` alternatives. A false fail is a fail the label does not allow. A missed fail is a labeled fail that came back pass or not applicable. Fail to review is a labeled fail that came back review, which is the intended result on photos whenever a misread could explain the fail.
- Review rate is reviews divided by checks run. Checks not run are semantic checks whose model step was skipped.
- Photo and page-image sets run with the photo rule (engine input `images`). Set d also shows the same extraction under the PDF rules, so the true fails the photo rule turns into reviews are visible.
- Page images for sets d and the real lists are rendered at 150 DPI, 8-bit grayscale, with PDFKit (`test/eval/render-pages.swift`), outside the Worker.
- Verdicts come from rules engine version `engine-3`.
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

This run spent $0.0000 on the Meta Model API and $0.0000 on Baseten.
