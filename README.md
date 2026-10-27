# Itemized

Itemized checks funeral home price lists against the FTC Funeral Rule and flags missing required disclosures and prices, with citations.

Built by Butch Ewing during the Meta Global AI Developer Hackathon. Live at https://itemized.mortuary.ai.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/butchewing/itemized)

**Deploy your own.** The button deploys Itemized to your own Cloudflare account and creates its database, storage bucket and queue there. You need a Meta Model API key; a Baseten key is optional. Cloudflare's free-tier limits apply, and model calls are billed to your Meta account.

Itemized is an automated, AI-assisted check against the federal FTC Funeral Rule only. It does not check state law or the other price lists and statements the Rule requires, and the AI can misread documents. Results are not legal advice. Funeral homes should confirm results with their attorney or state funeral regulator.

## The Funeral Rule

The Funeral Rule is a federal regulation enforced by the Federal Trade Commission. It lets families choose only the funeral goods and services they want, pay only for those, and compare prices between funeral homes. A funeral home must give a General Price List showing each item and service it offers and what it costs. The FTC checks compliance with undercover inspections every year. See the FTC's pages [for families](https://consumer.ftc.gov/articles/ftc-funeral-rule) and [for funeral providers](https://www.ftc.gov/news-events/topics/truth-advertising/funeral-rule).

## What it does

You upload a phone photo or PDF of a funeral home's General Price List. Itemized checks it against the FTC Funeral Rule (16 CFR 453) and reports each requirement as pass, fail or needs review, with the rule it comes from.

A Meta model reads the price list into structured data. A deterministic rules engine then checks that data. Only the rules engine can mark a requirement as failed. Anything that depends on the model's judgment is marked for human review, so the tool never accuses a funeral home on a model's say-so.

## Models

- **Muse Spark** through the Meta Model API reads photos and PDFs into structured data.
- **Muse Spark Open** on Baseten (`meta-models/muse-spark-open-1026`, the hackathon model) is a second extraction backend. It lets us compare accuracy against the hosted API, and run evaluations on real price lists without sending them to a hosted API. It takes images, not PDFs.
- **SAM 3.1** for segmenting phone photos is under evaluation.

## Status

In progress. Uploads are accepted, stored and queued. The extraction and checking pipeline is being built.

## Local development

There are two Wrangler configurations. `wrangler.jsonc` is portable: it names no account, domain or resource IDs, and it is what the Deploy to Cloudflare button uses. `wrangler.production.jsonc` holds the settings for itemized.mortuary.ai.

```
cp .dev.vars.example .dev.vars   # then fill in META_API_KEY
npx wrangler d1 migrations apply DB --local
npm run dev
```

To work against the production configuration locally, use `npx wrangler d1 migrations apply DB --local -c wrangler.production.jsonc` and `npm run dev:production`.

Run `npm run types` after changing either configuration (types come from `wrangler.production.jsonc`), and `npm run typecheck` and `npm test` to check the code.

Deploying:

- `npm run deploy` applies D1 migrations and deploys with the portable configuration. The button runs this in your account.
- `npm run deploy:production` applies D1 migrations and deploys itemized.mortuary.ai with `wrangler.production.jsonc`.

Secrets are set with `wrangler secret put`, not stored in the repo: `META_API_KEY`, and `BASETEN_API_KEY` if you use the open-weights provider.

## Provenance

See [PROVENANCE.md](PROVENANCE.md) for what existed before the hackathon and what was built during it.

## License

Copyright 2026 Butch Ewing. Licensed under the [Apache License, Version 2.0](LICENSE).
