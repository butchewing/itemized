import { MAX_PAGES } from './audit';
import { escapeHtml, LIMITS_PARAGRAPHS } from './letter';

// The site's prose, written once in a small Markdown subset and served two ways: as HTML in the house
// style and as text/markdown for agents (llms.txt, and any page asked for with Accept: text/markdown).

export const SITE = 'https://itemized.mortuary.ai';
// Bump when the site's prose changes; it is the sitemap's lastmod.
export const SITE_LAST_UPDATED = '2026-10-27';
export const CONTACT_EMAIL = 'itemized@mortuary.ai';
const REPO = 'https://github.com/butchewing/itemized';
export const DESCRIPTION =
  'Itemized checks funeral home price lists against the FTC Funeral Rule and flags missing required disclosures and prices, with citations.';

// Inline: **bold** and [text](url). Blocks: "## Heading" (optionally "{#id}"), "- " list items, paragraphs.
const inline = (text: string) =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t: string, u: string) => `<a href="${u}">${t}</a>`);

export function mdToHtml(md: string): string {
  return md
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const heading = block.match(/^## (.+?)(?: \{#([\w-]+)\})?$/);
      if (heading) return `<h2${heading[2] ? ` id="${heading[2]}"` : ''}>${inline(heading[1]!)}</h2>`;
      const lines = block.split('\n');
      if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('\n  ');
}

// Agents get the Markdown without the HTML-only heading ids.
export const plainMd = (md: string) => md.trim().replace(/ \{#[\w-]+\}$/gm, '');

const htmlToMd = (html: string) =>
  html
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .split(/<\/p>\s*/)
    .map((p) => p.replace(/<p>/, '').trim())
    .filter(Boolean)
    .join('\n\n');

export const LIMITS_MD = htmlToMd(LIMITS_PARAGRAPHS);

export const REFERENCE_MD = `
## What is the Funeral Rule? {#rule-heading}

The Funeral Rule is a federal regulation enforced by the Federal Trade Commission. It lets families choose only the funeral goods and services they want, pay only for those, and compare prices between funeral homes. A funeral home must give a General Price List, which the family can keep, showing each item and service it offers and what it costs. The FTC checks compliance with undercover inspections every year.

Read more from the FTC: [the Funeral Rule for families](https://consumer.ftc.gov/articles/ftc-funeral-rule), [the Funeral Rule for funeral providers](https://www.ftc.gov/news-events/topics/truth-advertising/funeral-rule), and, for funeral homes, the FTC's guide, [Complying with the Funeral Rule](https://www.ftc.gov/business-guidance/resources/complying-funeral-rule).

## Why it matters

The FTC enforces the Funeral Rule with undercover calls and visits. After calling more than 250 funeral homes, it sent warning letters to 39 of them in January 2024 and said violations can bring penalties of up to $51,744 each. In earlier undercover visits to 90 funeral homes in five states, 17 did not give itemized prices when they should have.

Sources: the FTC’s [January 2024 announcement](https://www.ftc.gov/news-events/news/press-releases/2024/01/ftc-sends-warning-letters-funeral-homes-after-first-undercover-phone-sweep) and its [2020 inspection results](https://www.ftc.gov/news-events/news/press-releases/2020/06/ftc-releases-funeral-home-compliance-results-offers-new-business-guidance-funeral-rule-requirements).

## What Itemized checks

- **Required statements.** The notices the Rule requires on a General Price List, such as the statement that embalming is usually not required by law, compared with the Rule's own wording.
- **Itemized prices.** A price for each required item and service. A vague price, such as one shown as "starting at", goes to a person to review.
- **Required options.** Choices the Rule says a family must be offered, such as direct cremation with an alternative container.

## How it decides

- **Meta's Muse Spark reads the list.** It writes down every item, price and statement, and the page each one came from.
- **Fixed rules decide what passes.** The rules are written from the Rule's text, and only they can mark a requirement as not passed. Each result cites the section of the Rule and quotes the list.
- **Anything uncertain goes to a person.** When a photo is hard to read or wording calls for judgment, the result is "needs a person's review", never "did not pass".

## Who it is for

- **Funeral homes** checking a list before an inspection, or before printing a new one.
- **Families** who want to know what a General Price List should include.
`;

export const HEADLINE = 'Does this price list meet the Funeral Rule?';
export const HERO_LEDE =
  'Itemized checks a funeral home’s General Price List against the Federal Trade Commission’s Funeral Rule. Upload a PDF or photos of the pages, and a letter comes back, usually in under a minute: what did not pass, what a person should look at, and what passed, each tied to the part of the Rule it comes from.';
export const AUDIENCE = [
  ['For funeral homes', 'Check your list before an inspection, or before you print a new one.'],
  ['For families', 'See what a funeral home’s price list has to include.'],
] as const;

export type SampleList = { name: string; note: string; versions: { label: string; files: string[] }[] };
export const SAMPLES: SampleList[] = [
  {
    name: 'Juniper Hollow Funeral Home',
    note: 'A complete list. Every check passes.',
    versions: [{ label: 'PDF', files: ['syn-01.pdf'] }, { label: 'Photos', files: ['syn-01-1.jpeg', 'syn-01-2.jpeg'] }],
  },
  {
    name: 'Bellwether Memorial Chapel',
    note: 'Missing required statements and options.',
    versions: [{ label: 'PDF', files: ['syn-03.pdf'] }],
  },
  {
    name: 'Marrowfield Funeral Home',
    note: 'Vague prices and claims a person should review.',
    versions: [{ label: 'PDF', files: ['syn-10.pdf'] }, { label: 'Photos', files: ['syn-10-1.jpeg', 'syn-10-2.jpeg'] }],
  },
];

const SAMPLES_MD = SAMPLES.map(
  (s) => `- ${s.name}: ${s.note} ${s.versions.map((v) => `${v.label}: ${v.files.map((f) => `[${f}](${SITE}/samples/${f})`).join(', ')}`).join('; ')}`,
).join('\n');

const UPLOAD_NOTICE =
  'Documents are processed by Meta AI models, and Meta may use them to improve its products. Uploaded files and their reviews are deleted 30 days after the file was last uploaded. Upload only price lists you are allowed to share.';

// For an agent acting for a person: when Itemized is the right tool, and the three calls that use it.
const AGENTS_MD = `
## When to use Itemized

- A funeral home wants to check its General Price List against the FTC Funeral Rule before an inspection or before printing a new list.
- A family, journalist or consumer advocate has a funeral home's General Price List and wants to know which of the Rule's requirements it meets.
- Someone drafting a General Price List wants to see which required statements or options are missing.

Do not use it for state funeral law, the Casket Price List, the Outer Burial Container Price List, the Statement of Funeral Goods and Services Selected, legal advice, or comparing prices between funeral homes. It reviews US lists under the federal Funeral Rule only.

## How an agent calls Itemized

1. Upload the list: \`POST ${SITE}/api/audits\` as multipart/form-data with the file in a field named \`file\`. Send one PDF, or up to ${MAX_PAGES} page images (JPEG, PNG or WebP) in page order, each in its own \`file\` field; 20 MB per file and 24 MB in total. The response is \`202\` with \`{"id": "...", "status": "queued"}\`.
2. Poll \`GET ${SITE}/api/audits/{id}\` every few seconds until \`status\` is \`done\` or \`failed\`. A finished audit carries \`report.findings\`: each finding has a \`checkId\`, a \`verdict\` (fail, review, pass or not_applicable), the citation it rests on, and the quoted text from the list.
3. Give the person the review: \`${SITE}/r/{id}\` is the letter as a web page and \`${SITE}/r/{id}/pdf\` is the same letter as a PDF.

Uploads are limited to 5 a minute per address, and Itemized has a daily spending limit shared by everyone; a \`429\` or a \`daily budget reached\` error means try later. Re-uploading the same file within 30 days returns the earlier review without reading it again. Before uploading for someone, tell them: ${UPLOAD_NOTICE}

A "fail" comes only from fixed rules written from the Rule's text. Anything that depends on the model's judgment is marked "review" for a person to decide. Present results as a check against the Rule, not as a finding that anyone broke the law.
`;

const LINKS_MD = `
## More

- [Source code and evaluation](${REPO}): Apache-2.0. EVAL.md has the accuracy numbers.
- [About Itemized](${SITE}/about)
- [Privacy](${SITE}/privacy)
- [Contact](${SITE}/contact)
`;

export const HOME_MD = `# Itemized

> ${DESCRIPTION}

## ${HEADLINE}

${HERO_LEDE}

${AUDIENCE.map(([who, what]) => `- **${who}.** ${what}`).join('\n')}

Review a list at ${SITE}. ${UPLOAD_NOTICE}

## Sample lists

Fictional funeral homes, written to show what Itemized finds.

${SAMPLES_MD}

${plainMd(REFERENCE_MD)}

## About these results

${LIMITS_MD}

${AGENTS_MD.trim()}

${LINKS_MD.trim()}
`;

// llmstxt.org: an H1, a blockquote summary, then sections whose lists are links.
export const LLMS_TXT = `# Itemized

> ${DESCRIPTION} Free to use at ${SITE}; built by Butch Ewing during the Meta Global AI Developer Hackathon.

Itemized reviews a US funeral home's General Price List against the Federal Trade Commission's Funeral Rule (16 CFR Part 453). A Meta Muse Spark model transcribes the list; fixed rules written from the Rule's text decide what passes. Results are pass, fail, review or not applicable, each with the Rule section it comes from.

${AGENTS_MD.trim()}

## Docs

- [Itemized home page, as Markdown](${SITE}/): request it with \`Accept: text/markdown\`.
- [The FTC's guide, Complying with the Funeral Rule](https://www.ftc.gov/business-guidance/resources/complying-funeral-rule): what a General Price List must include.
- [Source code](${REPO}): the rules, the checks and the evaluation (EVAL.md).

## Optional

- [Sample lists](${SITE}/samples/syn-03.pdf): fictional price lists to try; see the home page for all five.
- [About](${SITE}/about), [Privacy](${SITE}/privacy), [Contact](${SITE}/contact)
`;

export type SitePage = { path: string; title: string; heading: string; md: string };

export const ABOUT: SitePage = {
  path: '/about',
  title: 'About Itemized',
  heading: 'About Itemized',
  md: `
Itemized checks a funeral home's General Price List against the Federal Trade Commission's Funeral Rule (16 CFR Part 453). It was built by Butch Ewing during the Meta Global AI Developer Hackathon (October 26 to November 4, 2026), and it is free to use. It is hosted on mortuary.ai, the domain of Mortuary.AI, a company Butch Ewing also runs.

## Why it exists

The Funeral Rule gives families the right to an itemized price list so they can choose and pay for only what they want. The FTC checks compliance with undercover calls and visits, and in its 2020 inspection results, 17 of 90 funeral homes visited did not give itemized prices when they should have. Many funeral homes are small businesses without a compliance department. Itemized gives them, and the families they serve, a quick reading of a list against the Rule's requirements.

## How it decides

A Meta Muse Spark model transcribes the list into structured data: each item, each price, and each block of notice text, with the page it came from. Fixed rules written from the Rule's text then check that data. Only those fixed rules can mark a requirement as not passed. Questions that need judgment about wording or placement go to the model, and those results can only be marked for a person to review. Every result cites the section of the Rule it comes from and quotes the part of the list it is based on.

The rules, the checks and the evaluation are open source under the Apache-2.0 license at [github.com/butchewing/itemized](${REPO}). The evaluation, in EVAL.md, measures every check against labeled price lists, including fictional lists written for the purpose and the FTC's own sample list.

## What it does not do

${LIMITS_MD}

## Contact

Questions, corrections and deletion requests: [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).
`,
};

export const PRIVACY: SitePage = {
  path: '/privacy',
  title: 'Itemized: privacy',
  heading: 'Privacy',
  md: `
Itemized has no accounts, sets no cookies and runs no analytics or advertising scripts. This page says what happens to a price list you upload and to the other data a visit creates.

## What you upload

When you upload a price list, Itemized stores the file, a fingerprint of it (a SHA-256 hash), its file name, the text the model transcribed from it, and the review. The file and the transcription are sent to Meta's Model API to be read and checked. Meta may use them to improve its products. Upload only price lists you are allowed to share. A General Price List is a public price document and should not contain anyone's personal information; do not upload documents that do.

## Who can see a review

Each review has a long, random link. Anyone you give the link to can open the review and download it as a PDF. Review pages tell search engines not to index them.

## How long it is kept

Uploaded files, transcriptions and reviews are deleted 30 days after the file was last uploaded. Uploading the same file again within those 30 days shows the earlier review and restarts the 30 days. To have a review deleted sooner, email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}) with its link.

## Other data a visit creates

- **Cloudflare** hosts Itemized. It processes each request, including your IP address, to deliver the site and protect it from abuse. Itemized uses your IP address to limit uploads to 5 a minute and does not store it with your upload.
- **Usage records**: for each review, Itemized records which model read the list, how long it took and what it cost, to stay within its daily spending limit.

## Questions

Email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).
`,
};

export const CONTACT: SitePage = {
  path: '/contact',
  title: 'Itemized: contact',
  heading: 'Contact',
  md: `
Itemized was built by Butch Ewing. For questions about a review, corrections to a check, deletion requests, or problems with the site, email [${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL}).

When writing about a review, include its link (it starts with ${SITE}/r/). Itemized cannot see who uploaded a list, so the link is the only way to find it.

## What we can and cannot help with

We can explain why Itemized gave a result, fix a check that reads the Rule wrongly, and delete a review before its 30 days are up. We cannot give legal advice, review state law, or say whether a funeral home broke the law.

For a question about your own funeral arrangements, ask the funeral home first. You can also contact the [Federal Trade Commission](https://reportfraud.ftc.gov/) or the state agency that licenses funeral homes. Funeral homes should confirm any result with their attorney or their state funeral regulator before acting on it.

## Source code

Itemized is open source under the Apache-2.0 license. Bug reports and suggestions are welcome as issues at [github.com/butchewing/itemized](${REPO}/issues).
`,
};

export const SITE_PAGES = [ABOUT, PRIVACY, CONTACT];

export const pageMd = (p: SitePage) => `# ${p.heading}\n\n${plainMd(p.md)}\n`;

export const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /r/
Disallow: /dev/

Sitemap: ${SITE}/sitemap.xml
`;

export const sitemapXml = (lastmod: string) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/llms.txt', ...SITE_PAGES.map((p) => p.path)]
  .map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${lastmod}</lastmod></url>`)
  .join('\n')}
</urlset>
`;

export const notFoundMd = (path: string) => `# Not found

Itemized has no page at \`${path}\`. The link may be incomplete or out of date, or a review may have been deleted after 30 days.

- [Itemized home page](${SITE}/)
- [What Itemized does and how to call it](${SITE}/llms.txt)
- [Sitemap](${SITE}/sitemap.xml)
`;

export const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://www.mortuary.ai/#organization',
      name: 'Mortuary.AI',
      url: 'https://www.mortuary.ai',
      email: CONTACT_EMAIL,
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: CONTACT_EMAIL, url: `${SITE}/contact` },
    },
    {
      '@type': 'WebApplication',
      '@id': `${SITE}/#app`,
      name: 'Itemized',
      url: `${SITE}/`,
      description: DESCRIPTION,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any (web browser)',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@type': 'Person', name: 'Butch Ewing', url: 'https://github.com/butchewing' },
      sameAs: [REPO],
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
    },
  ],
};

// "<" is the only character that can end the script element early; JSON allows it escaped.
export const jsonLdScript = () => `<script type="application/ld+json">${JSON.stringify(JSON_LD).replace(/</g, '\\u003c')}</script>`;

// True when the client ranks text/markdown above text/html. Absent or wildcard Accept stays HTML.
export function prefersMarkdown(accept: string | undefined): boolean {
  if (!accept) return false;
  const q = (type: string) => {
    let best = -1;
    for (const part of accept.split(',')) {
      const [media, ...params] = part.trim().toLowerCase().split(';');
      if (media !== type) continue;
      const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      best = Math.max(best, qp ? Number(qp.slice(2)) || 0 : 1);
    }
    return best;
  };
  const md = q('text/markdown');
  return md > 0 && md > q('text/html');
}
