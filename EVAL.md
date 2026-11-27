# Itemized eval

Produced by `npm run eval` (`test/eval/run.mjs`). Machine-readable results for the public sets are in `test/eval/results.json`.

## Results

| Set | Model | n | Fields | Disclosures | Verdict agreement | False fails | Missed fails | Fail to review | Review rate | Checks not run | Cost per review, mean / p90 | Model time per review, mean / p90 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a. Synthetic PDFs | Muse Spark 1.3 (Meta Model API) | 12 | 1087/1088 | 95/96 | 558/560 (99.6%) | 0 | 0 | 1 | 2.3% | 0 | $0.0324 / $0.0374 | 20.1 s / 26.1 s |
| b. Synthetic photos | Muse Spark 1.3 (Meta Model API) | 4 | 344/356 | 32/32 | 182/188 (96.8%) | 0 | 0 | 5 | 6.4% | 0 | $0.0357 / $0.0384 | 13.5 s / 14.8 s |
| c. Synthetic photos | Muse Spark Open (Cloudflare, served by Fireworks) | 4 | 341/356 | 32/32 | 182/188 (96.8%) | 0 | 0 | 5 | 6.4% | 0 | $0.0337 / $0.0349 | 17.4 s / 20.1 s |
| d. Synthetic PDFs as page images | Muse Spark Open (Cloudflare, served by Fireworks) | 12 | 1085/1088 | 95/96 | 541/560 (96.6%) | 0 | 0 | 18 | 5.4% | 0 | $0.0279 / $0.0334 | 15.5 s / 18.8 s |
| d. Same extraction, PDF rules (diagnostic) | Muse Spark Open (Cloudflare, served by Fireworks) | 12 | 1085/1088 | 95/96 | 557/560 (99.5%) | 0 | 0 | 2 | 2.5% | 0 | $0.0279 / $0.0334 | 15.5 s / 18.8 s |
| e. FTC Sample 1 template | Muse Spark 1.3 (Meta Model API) | 1 | n/a | n/a | 43/43 (100.0%) | 0 | 0 | 0 | 7.0% | 0 | $0.0310 / $0.0310 | 20.5 s / 20.5 s |
| g. Synthetic PDFs | Claude Sonnet 5.5 (Anthropic API) | 12 | 1088/1088 | 95/96 | 554/560 (98.9%) | 0 | 0 | 0 | 2.0% | 0 | $0.0618 / $0.0647 | 18.1 s / 20.0 s |
| h. Synthetic photos | Claude Sonnet 5.5 (Anthropic API) | 4 | 355/356 | 32/32 | 182/188 (96.8%) | 0 | 0 | 5 | 5.9% | 0 | $0.0689 / $0.0726 | 18.5 s / 20.0 s |
| i. FTC Sample 1 template | Claude Sonnet 5.5 (Anthropic API) | 1 | n/a | n/a | 43/43 (100.0%) | 0 | 0 | 0 | 7.0% | 0 | $0.0616 / $0.0616 | 19.9 s / 19.9 s |
| j. Synthetic PDFs | Claude Haiku 5.5 (Anthropic API) | 12 | 1087/1088 | 94/96 | 556/560 (99.3%) | 0 | 0 | 1 | 2.5% | 0 | $0.0038 / $0.0043 | 19.2 s / 22.9 s |
| k. Synthetic photos | Claude Haiku 5.5 (Anthropic API) | 4 | 292/356 | 31/32 | 171/188 (91.0%) | 0 | 0 | 5 | 9.0% | 0 | $0.0054 / $0.0063 | 28.5 s / 36.4 s |
| l. FTC Sample 1 template | Claude Haiku 5.5 (Anthropic API) | 1 | n/a | n/a | 42/43 (97.7%) | 0 | 0 | 0 | 9.3% | 0 | $0.0049 / $0.0049 | 27.4 s / 27.4 s |
| u. Synthetic PDFs rendered by the Worker, photo rule | Muse Spark Open (Cloudflare, served by Fireworks) | 12 | 1086/1088 | 95/96 | 541/560 (96.6%) | 0 | 0 | 18 | 5.4% | 0 | $0.0289 / $0.0309 | 17.4 s / 20.2 s |
| u. Same, PDF rules (the product's choice for these 2-page lists) | Muse Spark Open (Cloudflare, served by Fireworks) | 12 | 1086/1088 | 95/96 | 557/560 (99.5%) | 0 | 0 | 2 | 2.5% | 0 | $0.0289 / $0.0309 | 17.4 s / 20.2 s |
| v. FTC template rendered by the Worker, photo rule | Muse Spark Open (Cloudflare, served by Fireworks) | 1 | n/a | n/a | 39/43 (90.7%) | 0 | 0 | 4 | 16.3% | 0 | $0.0260 / $0.0260 | 19.6 s / 19.6 s |
| v. Same, PDF rules (the product's choice) | Muse Spark Open (Cloudflare, served by Fireworks) | 1 | n/a | n/a | 43/43 (100.0%) | 0 | 0 | 0 | 7.0% | 0 | $0.0260 / $0.0260 | 19.6 s / 19.6 s |

## Real price lists (aggregates only)

12 redacted real General Price Lists ran on Muse Spark Open (Cloudflare, served by Fireworks), as page images. A list with more pages than the provider takes in one request (8 images) is read in batches of pages and merged. No real list was sent to the Meta Model API or to any other provider.

| Measure | Value |
|---|---|
| Lists run | 12 |
| Verdicts (fail / review / pass / not applicable) | 0 / 95 / 368 / 53 |
| Fails per list, mean | 0.0 |
| Review rate | 18.4% |
| Checks not run | 0 |
| Name, address or phone checks counted as pass because the element was redacted | 30 |
| Hand-labeled list: verdict agreement | 39/43 |
| Hand-labeled list: false fails / missed fails / fail to review | 0 / 0 / 4 |
| Same extractions under the PDF rules (diagnostic): fails, and lists with at least one | 18, 7 of 12 |
| Hand-labeled list under the PDF rules: agreement; false fails / missed fails | 40/43; 0 / 0 |
| Cost per review, mean / p90 | $0.0745 / $0.1094 |
| Model time per review, mean / p90 | 47.0 s / 76.3 s |

## Run-to-run variance

The main table runs each document once, so it cannot show how much a fresh extraction moves between runs. To measure that, syn-03 was extracted five times per model with the cache bypassed (`test/eval/extraction-variance.mjs`, raw runs in `test/eval/variance/`). Muse Spark 1.3 read the PDF, as in set a. Muse Spark Open read the rendered page image, as in set d. Each run was scored against the list's ground truth and put through the deterministic checks under both the photo rule and the PDF rule. The 13 semantic checks were not run, so 30 checks are compared.

| Measure, 5 runs each | Muse Spark 1.3 (PDF) | Muse Spark Open on Baseten, retired (page image) |
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

c. Synthetic photos, muse-open:
- syn-03 C-030 (fail to review: expected fail, got review)
- syn-03 C-041 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)
- syn-03 C-007 (other: expected pass, got review)

d. Synthetic PDFs as page images, muse-open:
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

d. Same extraction, PDF rules (diagnostic), muse-open:
- syn-07 C-005 (fail to review: expected fail, got review)
- syn-07 C-060 (fail to review: expected fail, got review)
- syn-07 C-061 (other: expected pass, got review)

e. FTC Sample 1 template, meta-api: none.

g. Synthetic PDFs, claude-sonnet:
- syn-10 C-032 (other: expected review, got pass)
- syn-10 C-081 (other: expected review, got pass)
- syn-10 C-082 (other: expected review, got pass)
- syn-11 C-045 (other: expected pass, got review)
- syn-11 C-081 (other: expected pass, got review)
- syn-11 C-083 (other: expected pass, got review)

h. Synthetic photos, claude-sonnet:
- syn-03 C-030 (fail to review: expected fail, got review)
- syn-03 C-041 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)
- syn-10 C-082 (other: expected review, got pass)

i. FTC Sample 1 template, claude-sonnet: none.

j. Synthetic PDFs, claude-haiku:
- syn-08 C-061 (fail to review: expected fail, got review)
- syn-05 C-080 (other: expected not_applicable, got pass)
- syn-08 C-060 (other: expected pass, got review)
- syn-11 C-083 (other: expected pass, got review)

k. Synthetic photos, claude-haiku:
- syn-03 C-030 (fail to review: expected fail, got review)
- syn-03 C-041 (fail to review: expected fail, got review)
- syn-09 C-022 (fail to review: expected fail, got review)
- syn-09 C-042 (fail to review: expected fail, got review)
- syn-09 C-052 (fail to review: expected fail, got review)
- syn-01 C-043 (other: expected pass, got review)
- syn-01 C-053 (other: expected pass, got review)
- syn-01 C-070 (other: expected pass, got review)
- syn-03 C-007 (other: expected pass, got review)
- syn-03 C-061 (other: expected pass, got review)
- syn-09 C-070 (other: expected pass, got review)
- syn-10 C-032 (other: expected review, got pass)
- syn-10 C-043 (other: expected pass, got review)
- syn-10 C-070 (other: expected pass, got review)
- syn-10 C-073 (other: expected pass, got review)
- syn-10 C-081 (other: expected review, got pass)
- syn-10 C-082 (other: expected review, got pass)

l. FTC Sample 1 template, claude-haiku:
- ftc C-080 (other: expected not_applicable, got review)

u. Synthetic PDFs rendered by the Worker, photo rule, muse-open:
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

u. Same, PDF rules (the product's choice for these 2-page lists), muse-open:
- syn-07 C-005 (fail to review: expected fail, got review)
- syn-07 C-060 (fail to review: expected fail, got review)
- syn-07 C-061 (other: expected pass, got review)

v. FTC template rendered by the Worker, photo rule, muse-open:
- ftc C-040 (fail to review: expected fail, got review)
- ftc C-041 (fail to review: expected fail, got review)
- ftc C-050 (fail to review: expected fail, got review)
- ftc C-070 (fail to review: expected fail, got review)

v. Same, PDF rules (the product's choice), muse-open: none.

## Method

- Every set goes through the local Worker the same way an upload does: store, queue, extract, semantic checks, rules engine. The harness then asks a development route for the engine verdicts on the cached extraction, with the audit date fixed at 2026-10-26 so the stale-date check does not drift between runs.
- Fields and disclosures score the extraction against ground truth parsed from the synthetic lists' HTML sources (`test/eval-extraction.mjs`). The FTC template and the real lists have no field-level ground truth.
- Verdicts are compared per check with `prep/synthetic/labels.json`, `specimens/labels.json` (checks it does not list are expected to pass) and the hand labels for one real list. A check with several findings counts as its most severe verdict. Agreement means the verdict is the label or one of its `also_ok` alternatives. A false fail is a fail the label does not allow. A missed fail is a labeled fail that came back pass or not applicable. Fail to review is a labeled fail that came back review, which is the intended result on photos whenever a misread could explain the fail.
- Review rate is reviews divided by checks run. Checks not run are semantic checks whose model step was skipped.
- Photo and page-image sets run with the photo rule (engine input `images`). Set d also shows the same extraction under the PDF rules, so the true fails the photo rule turns into reviews are visible.
- Page images for sets d and the real lists are rendered at 150 DPI, 8-bit grayscale, with PDFKit (`test/eval/render-pages.swift`), outside the Worker.
- Verdicts come from rules engine version `engine-6`.
- Cost and model time per review are the extraction call plus the semantic call that produced each cached result, read from the local `model_calls` table. Each document ran once (n=1 per document and model). The numbers carry sampling noise that a single run cannot show.
- Real price lists run on one provider only: Muse Spark Open (Cloudflare, served by Fireworks) since 2026-11-24, Baseten before that. The harness refuses any real-list file unless the running Worker reports that provider, and a test asserts that rule. Per-list results stay in a private, gitignored folder; this file carries aggregates only.
- Sets g to l run the same public documents as sets a, b and e on Claude Sonnet 5.5 and Claude Haiku 5.5 through the Anthropic API, at effort low for transcription and for the semantic checks. They are a comparison only; the live site runs Muse Spark 1.3.
- Texas checks (tx-651@2026.1, TX-001 to TX-004) run only when the list's address is in Texas. Eleven synthetic lists have Texas addresses (syn-07 has none), so the PDF and page-image sets carry 44 Texas labels and the photo sets 16 (4 lists × 4). syn-02 reviews the selection notice (TX-002); syn-11's reworded notice is left to the federal check. No synthetic list offers insurance claim filing, mentions insurance, or says it runs a crematory, so TX-001, TX-003 and TX-004 are covered by unit tests (test/texas.test.ts), not by the eval. The real lists' addresses are redacted, so no Texas check runs on them.
- Cloudflare-hosted Gemma 4 26B, Llama 4 Scout and Qwen 3.8 27B (sets m to r) did not finish one document each on 2026-11-24: Workers AI timed out after about 6 minutes, or the harness after 10, so they have no rows. Mistral Large 4 on Ollama Cloud (sets s and t) has not run yet.

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

Spend is capped per run and provider: $1 on Muse Spark 1.3 (Meta Model API), $4 on Muse Spark Open (Cloudflare, served by Fireworks), $1 on Gemma 4 26B (Cloudflare-hosted), $1 on Llama 4 Scout (Cloudflare-hosted), $2 on Qwen 3.8 27B (Cloudflare-hosted), $2 on Mistral Large 4 (Ollama Cloud), $7 on Claude Sonnet 5.5 (Anthropic API), $3 on Claude Haiku 5.5 (Anthropic API) (override with `--cap-<provider>`). Set f needs the private corpus, so leave it out of `--sets` elsewhere.

The last run (sets on Muse Spark 1.3 (Meta Model API), sets on Muse Spark Open (Cloudflare, served by Fireworks), sets on Claude Sonnet 5.5 (Anthropic API), sets on Claude Haiku 5.5 (Anthropic API)) spent $0.0000 on Muse Spark 1.3 (Meta Model API), $0.0000 on Muse Spark Open (Cloudflare, served by Fireworks), $0.0000 on Claude Sonnet 5.5 (Anthropic API), $0.0000 on Claude Haiku 5.5 (Anthropic API).
