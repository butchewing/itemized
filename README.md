# Itemized

Itemized checks funeral home price lists against the FTC Funeral Rule and flags missing required disclosures and prices, with citations.

Built for the Meta Global AI Developer Hackathon. Live at https://itemized.mortuary.ai. It is a compliance-review aid, not legal advice.

## What it does

You upload a phone photo or PDF of a funeral home's General Price List. Itemized checks it against the FTC Funeral Rule (16 CFR 453) and reports each requirement as pass, fail or needs review, with the rule it comes from.

A Meta model reads the price list into structured data. A deterministic rules engine then checks that data. Only the rules engine can mark a requirement as failed. Anything that depends on the model's judgment is marked for human review, so the tool never accuses a funeral home on a model's say-so.

## Models

- **Muse Spark** through the Meta Model API reads photos and PDFs into structured data.
- **Muse Spark Open** on Baseten (`meta-models/muse-spark-open`) is a second extraction backend. It lets us compare accuracy against the hosted API, and run evaluations on real price lists without sending them to a hosted API. It takes images, not PDFs.
- **SAM 3.1** for segmenting phone photos is under evaluation.

## Status

In progress. Uploads are accepted, stored and queued. The extraction and checking pipeline is being built.

## Local development

```
npm run dev
npx wrangler d1 migrations apply itemized --local
```

Run `npm run types` after changing `wrangler.jsonc`, and `npm run typecheck` to check the code.

Secrets are set with `wrangler secret put`, not stored in the repo: `META_API_KEY`, and later `BASETEN_API_KEY`.

## Provenance

See [PROVENANCE.md](PROVENANCE.md) for what existed before the hackathon and what was built during it.
