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
