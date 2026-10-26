# Itemized

Itemized checks a funeral home's General Price List against the FTC Funeral Rule (16 CFR 453). You upload a PDF or a phone photo, and it reports which required disclosures and itemized prices are present, missing or worth a human look. It was built for the Meta Global AI Developer Hackathon. It is a compliance-review aid, not legal advice.

Status: in progress. Uploads are accepted and queued. The extraction and checking pipeline is not built yet.

## Local development

```
npm run dev
npx wrangler d1 migrations apply itemized --local
```

Run `npm run types` after changing `wrangler.jsonc`, and `npm run typecheck` to check the code.

Secrets are set with `wrangler secret put`, not stored in the repo: `META_API_KEY`, and later `BASETEN_API_KEY`.

## Provenance

See [PROVENANCE.md](PROVENANCE.md) for what existed before the hackathon and what was built during it.
