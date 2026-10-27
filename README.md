# Itemized

Itemized checks funeral home price lists against the FTC Funeral Rule and flags missing required disclosures and prices, with citations.

Built by Butch Ewing during the Meta Global AI Developer Hackathon. Live at https://itemized.mortuary.ai.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/butchewing/itemized)

Itemized is an automated, AI-assisted check against the federal FTC Funeral Rule only. It does not check state law or the other price lists and statements the Rule requires, and the AI can misread documents. Results are not legal advice. Funeral homes should confirm results with their attorney or state funeral regulator.

## Try it in 30 seconds

Open https://itemized.mortuary.ai and choose a sample list. The samples are fictional funeral homes:

- **Juniper Hollow** is a complete list. Every check passes, from the PDF and from phone photos.
- **Bellwether Memorial Chapel** is missing required statements and options. Three checks do not pass, each with the section of the Rule and the text it rests on.
- **Marrowfield** has vague pricing and claims that call for judgment. Nothing fails; the items that need judgment go to a person to review.

Each review is a letter you can open on its own page, download as a PDF, or hand to an AI assistant with the "fix it with your AI" prompt, which lists the exact sentences the list is missing.

## Why it matters

The Funeral Rule lets families choose only the funeral goods and services they want, pay only for those, and compare prices between funeral homes. Its core is the General Price List, which a funeral home must give to anyone who asks in person about arrangements. The FTC enforces it with undercover calls and visits. After calling more than 250 funeral homes, it sent warning letters to 39 of them in January 2024 and said violations can bring penalties of up to $51,744 each ([announcement](https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-sends-warning-letters-funeral-homes-after-first-undercover-phone-sweep)). In earlier undercover visits to 90 funeral homes, 17 did not give itemized prices when they should have ([2020 results](https://www.ftc.gov/news-events/news/press-releases/2020/06/ftc-releases-funeral-home-compliance-results-offers-new-business-guidance-funeral-rule-requirements)).

Many funeral homes are small businesses. Itemized gives them a reading of their list against the Rule before an inspector does, and gives families a way to see what a list should include.

## How it works

1. **Upload.** One PDF, or up to 10 phone photos of the pages in order. Files go to R2 and an audit goes on a Cloudflare Queue.
2. **Read.** Meta's Muse Spark transcribes the list into structured data with a strict JSON schema: every item and price, every block of notice text, and the page each came from. PDFs go in natively. If a read finds fewer than 3 notice blocks, Itemized reads the list again and keeps the fuller read, because a read that drops notices would turn present statements into false fails.
3. **Check, part one: 30 fixed rules.** A rules engine runs checks compiled from `prep/rules/ftc-453@2026.1.json`, a transcription of 16 CFR 453: required statements matched against the Rule's wording, itemized prices, and required options such as direct cremation with an alternative container. **Only these rules can mark a requirement as not passed.** When the evidence is unclear (a statement close to the Rule's wording but altered, or a line read from a photo rather than a clean PDF), the result is review, not fail.
4. **Check, part two: 13 judgment checks.** Questions that need judgment, such as whether a claim says the law requires a purchase or whether a required statement sits next to the right price, go to the model with the quoted text. These can only pass or go to a person for review. Itemized never accuses a funeral home on a model's say-so.
5. **Report.** A letter groups the results into did not pass, review and passed. Each finding cites its section of the Rule and quotes the part of the list it is based on. The same server-rendered letter backs the web page, a shareable review link and a PDF made with Cloudflare Browser Run.

Uploading the same file again within 30 days returns the earlier review without another model call. A daily job deletes files and reviews 30 days after their last upload.

## Meta models

- **Muse Spark 1.3** through the Meta Model API reads photos and PDFs and runs the 13 judgment checks. This is what the live site uses. A review costs about $0.03 to $0.04.
- **Muse Spark Open** on Baseten (`meta-models/muse-spark-open-1026`) is a second, open-weights backend for the same pipeline, selected with one setting. It reads page images (8 per request; longer lists are read in batches and merged). Every evaluation on real price lists ran on it, so no real list was sent to a hosted API.
- **SAM 3.1** was measured for cropping phone photos to the page before reading. On 8 photos the crops fixed three misreads but caused three new ones, and the rule was no new errors anywhere, so it is not used.

## Accuracy

[EVAL.md](EVAL.md) has the full tables, produced by `npm run eval` against labeled lists.

- **Zero false fails** on every labeled set: 12 synthetic PDFs and 4 photographed lists on both models, plus the FTC's own sample price list (43 of 43 checks right).
- **Synthetic PDFs on Muse Spark 1.3:** 514 of 516 verdicts match the labels; 1,087 of 1,088 fields read correctly.
- **Real lists:** 12 redacted real General Price Lists ran on Muse Spark Open. Only aggregate numbers are published.
- **Run-to-run variance:** five fresh reads of a synthetic list gave the same verdict on all 30 rule checks, on both models.

## For AI agents

- [`/llms.txt`](https://itemized.mortuary.ai/llms.txt) says when to use Itemized and how to call it.
- The home, about, privacy and contact pages, and the 404 page, answer `Accept: text/markdown` with Markdown.
- The API: `POST /api/audits` with the list as multipart `file` fields, poll `GET /api/audits/{id}` until `done`, then link the person to `/r/{id}` or `/r/{id}/pdf`. Uploads are limited to 5 a minute per address.

## Privacy

No accounts, cookies or analytics, and the browser talks only to itemized.mortuary.ai; the fonts are self-hosted. Uploaded lists are processed by Meta AI models, and Meta may use them to improve its products. Files and reviews are deleted 30 days after the last upload. See [the privacy page](https://itemized.mortuary.ai/privacy).

## Local development

There are two Wrangler configurations. `wrangler.jsonc` is portable: it names no account, domain or resource IDs, and it is what the Deploy to Cloudflare button uses. `wrangler.production.jsonc` holds the settings for itemized.mortuary.ai.

```
cp .dev.vars.example .dev.vars   # then fill in META_API_KEY
npx wrangler d1 migrations apply DB --local
npm run dev
```

To work against the production configuration locally, use `npx wrangler d1 migrations apply DB --local -c wrangler.production.jsonc` and `npm run dev:production`.

Run `npm run types` after changing either configuration (types come from `wrangler.production.jsonc`), and `npm run typecheck` and `npm test` to check the code. `npm run eval` reruns the evaluation.

Deploying:

- `npm run deploy` applies D1 migrations and deploys with the portable configuration. The button runs this in your account and creates its database, storage bucket and queue there. You need a Meta Model API key; a Baseten key is optional. Model calls are billed to your Meta account.
- `npm run deploy:production` applies D1 migrations and deploys itemized.mortuary.ai with `wrangler.production.jsonc`.

Secrets are set with `wrangler secret put`, not stored in the repo: `META_API_KEY`, and `BASETEN_API_KEY` if you use the open-weights provider.

## Provenance

See [PROVENANCE.md](PROVENANCE.md) for what existed before the hackathon and what was built during it. In short: the ruleset transcription, the synthetic test lists and the FTC sample predate kickoff; all application code was written during the event, and the git history shows when.

## License

Copyright 2026 Butch Ewing. Licensed under the [Apache License, Version 2.0](LICENSE). The self-hosted fonts are under the SIL Open Font License; see `public/fonts/`.
