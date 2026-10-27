import { DESCRIPTION, SITE } from './site';

// One stationery stylesheet for the main page, the standalone review and its PDF.
export const STYLES = `
  /* Self-hosted Google Fonts files (Latin subset, variable), licensed under the OFL: see /fonts/OFL-*.txt. */
  @font-face { font-family: 'Cinzel'; font-style: normal; font-weight: 400 900; font-display: swap; src: url(/fonts/cinzel-latin.woff2) format('woff2'); }
  @font-face { font-family: 'Source Serif 4'; font-style: normal; font-weight: 200 900; font-display: swap; src: url(/fonts/source-serif-4-latin.woff2) format('woff2'); }
  @font-face { font-family: 'Source Serif 4'; font-style: italic; font-weight: 200 900; font-display: swap; src: url(/fonts/source-serif-4-italic-latin.woff2) format('woff2'); }
  :root {
    --ground: #e9ecef;
    --sheet: #ffffff;
    --ink: #20262e;
    --ink-deep: #000000;
    --slate: #556375;
    --rule: #d5dae0;
    --frame: #86909c;
    --gilt: #a8864a;
    --gilt-soft: #e7dcc6;
    --oxblood: #8a2b22;
    --row-wash: #f7f8f9;
    --drag-wash: #fbfaf7;
    --engraved: 'Cinzel', 'Trajan Pro', Georgia, serif;
    --text: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    color-scheme: light;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { background: var(--ground); }
  body {
    margin: 0;
    min-height: 100vh;
    font: 400 1.0625rem/1.6 var(--text);
    font-optical-sizing: auto;
    color: var(--ink);
    caret-color: var(--ink);
    background:
      repeating-linear-gradient(90deg, rgba(32, 38, 46, .018) 0 1px, transparent 1px 7px),
      var(--ground);
    padding: clamp(1rem, 4vw, 3.5rem) clamp(.75rem, 3vw, 2rem) 4rem;
  }
  ::selection { background: var(--gilt-soft); color: var(--ink); }
  a { color: inherit; text-decoration-color: var(--gilt); text-underline-offset: .2em; text-decoration-thickness: 1px; }
  a:hover { text-decoration-thickness: 2px; }
  :focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }

  .sheet {
    max-width: 44rem;
    margin: 0 auto;
    background: var(--sheet);
    padding: clamp(1.75rem, 6vw, 4rem) clamp(1.25rem, 6vw, 4.5rem) clamp(2rem, 6vw, 4rem);
    box-shadow: 0 1px 2px rgba(32, 38, 46, .06), 0 18px 40px -18px rgba(32, 38, 46, .28);
  }
  .sheet + .sheet { margin-top: clamp(2rem, 5vw, 3rem); }
  .sheet[hidden] { display: none; }
  .review-sheet { scroll-margin-top: clamp(1rem, 3vw, 2rem); }

  .letterhead { text-align: center; }
  .monogram { display: block; width: 3.5rem; height: 3.5rem; margin: 0 auto 1rem; fill: none; stroke: var(--gilt); stroke-linecap: square; }
  h1 {
    margin: 0;
    font: 600 clamp(2rem, 5.2vw, 2.75rem)/1 var(--engraved);
    letter-spacing: .2em;
    padding-left: .2em;
  }
  .gilt-hairline { width: min(15rem, 60%); margin: 1rem auto .85rem; border: 0; border-top: 1px solid var(--gilt); }
  .tagline { margin: 0; font-variant-caps: all-small-caps; letter-spacing: .12em; color: var(--slate); font-size: 1.05rem; }
  .lede { max-width: 33rem; margin: 1.75rem auto 0; text-align: center; font-size: 1.1rem; }

  .letterhead-compact .monogram { width: 2.25rem; height: 2.25rem; margin-bottom: .6rem; }
  .letterhead-compact .house { margin: 0; font: 600 1.25rem/1 var(--engraved); letter-spacing: .2em; padding-left: .2em; }
  .letterhead-compact .gilt-hairline { width: min(9rem, 40%); margin: .75rem auto 0; }

  .entry { margin-top: 2.5rem; }
  .entry-label { display: block; font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin-bottom: .6rem; }
  .field {
    display: grid; grid-template-columns: 1fr auto; gap: .75rem 1rem; align-items: center;
    padding: 1.1rem 1.25rem; border: 1px solid var(--frame); outline: 1px solid transparent; outline-offset: 4px;
    transition: border-color .2s ease-out, outline-color .2s ease-out, background-color .2s ease-out;
  }
  .field.dragging { border-color: var(--gilt); outline-color: var(--gilt-soft); background: var(--drag-wash); }
  .file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .file-name { font-style: italic; color: var(--slate); min-width: 0; overflow-wrap: anywhere; }
  .file-name.chosen { font-style: normal; color: var(--ink); }
  .field > .btn { grid-column: 2; grid-row: 1; }
  .field.has-pages { align-items: start; }
  .pages { grid-column: 1; grid-row: 1; min-width: 0; list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
  .pages li { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; padding: .2rem 0; border-bottom: 1px solid var(--rule); }
  .pages li span { min-width: 0; overflow-wrap: anywhere; font-variant-numeric: lining-nums; }
  .text-btn {
    font: 500 .8rem/1 var(--engraved); letter-spacing: .16em; text-transform: uppercase;
    color: var(--slate); background: none; border: 0; padding: .65rem 0; cursor: pointer;
    text-decoration: underline; text-decoration-color: var(--gilt); text-underline-offset: .35em;
  }
  .text-btn:hover { color: var(--ink); text-decoration-thickness: 2px; }
  .add-page { grid-column: 1; justify-self: start; color: var(--ink); }
  .btn {
    display: inline-block; text-decoration: none;
    font: 500 .8rem/1 var(--engraved); letter-spacing: .16em; text-transform: uppercase;
    color: var(--ink); background: transparent; border: 1px solid var(--ink);
    padding: .85rem 1.15rem .8rem; cursor: pointer; white-space: nowrap;
    transition: background-color .18s ease-out, color .18s ease-out;
  }
  .btn:hover:not(:disabled) { background: var(--ink); color: var(--sheet); }
  .btn-primary { background: var(--ink); color: var(--sheet); }
  .btn-primary:hover:not(:disabled) { background: var(--ink-deep); }
  .btn:disabled { background: transparent; color: var(--slate); border-color: var(--rule); cursor: not-allowed; }
  .submit-row { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; align-items: center; margin-top: 1rem; }
  .fine { font-size: .95rem; color: var(--slate); margin: 0; }

  .samples { margin-top: 2.5rem; }
  .samples h2 { font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin: 0 0 .35rem; }
  .samples .fine { margin-bottom: .5rem; }
  .samples ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
  .sample {
    display: grid; grid-template-columns: 1fr auto; column-gap: 1rem; width: 100%; text-align: left;
    font: inherit; color: inherit; background: none; border: 0; border-bottom: 1px solid var(--rule);
    padding: .85rem .25rem; cursor: pointer; transition: background-color .18s ease-out;
  }
  .sample:hover:not(:disabled) { background: var(--row-wash); }
  .sample:disabled { color: var(--slate); cursor: not-allowed; }
  .sample:disabled .sample-action { border-bottom-color: var(--rule); }
  .sample-name { font-weight: 600; }
  .sample-note { grid-column: 1; color: var(--slate); font-size: .95rem; }
  .sample-action { grid-column: 2; grid-row: 1 / span 2; align-self: center; font: 500 .8rem/1 var(--engraved); letter-spacing: .16em; text-transform: uppercase; border-bottom: 1px solid var(--gilt); padding-bottom: .2rem; }

  .status { margin: 2rem 0 0; min-height: 1.6em; font-style: italic; color: var(--slate); text-align: center; }
  .status.error { color: var(--oxblood); font-style: normal; }
  .engraving { display: block; height: 1px; width: min(12rem, 50%); margin: .6rem auto 0; background: var(--gilt); transform-origin: left; transform: scaleX(0); }
  .working .engraving { animation: engrave 1.6s cubic-bezier(.16, 1, .3, 1) infinite; }
  @keyframes engrave { 0% { transform: scaleX(0); opacity: 1; } 70% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }

  .letter { margin-top: 2.25rem; }
  .letter-date { text-align: right; color: var(--slate); margin: 0; font-variant-numeric: oldstyle-nums; }
  .letter-re { margin: 1.25rem 0 0; font: 600 1.15rem/1.35 var(--text); }
  /* Focus lands here programmatically (tabindex=-1) so screen readers start at the review; it is not a tab stop. */
  .letter-re:focus, .letter-re:focus-visible { outline: none; }
  .summary { margin: .75rem 0 0; }
  .summary strong { font-variant-numeric: lining-nums tabular-nums; }
  .key { margin: 1.25rem 0 0; padding: .9rem 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); display: grid; grid-template-columns: 1fr 1fr; gap: .6rem 1.5rem; font-size: .95rem; }
  .key dt { font-weight: 600; }
  .key dd { margin: .1rem 0 0; color: var(--slate); }
  .steps { max-width: 33rem; margin: 1.75rem auto 0; padding-left: 1.4rem; text-align: left; }
  .steps li { margin: .5rem 0; padding-left: .25rem; }
  .steps li::marker { font-family: var(--engraved); color: var(--gilt); }
  .group { margin-top: 2.25rem; }
  .group > h3 { font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin: 0; padding-bottom: .55rem; border-bottom: 1px solid var(--ink); display: flex; justify-content: space-between; gap: 1rem; }
  .group > h3 .count { font-family: var(--text); font-variant-numeric: lining-nums tabular-nums; letter-spacing: 0; text-transform: none; color: var(--slate); }
  .findings { list-style: none; margin: 0; padding: 0; }
  .finding { display: grid; grid-template-columns: minmax(0, 1fr) 9.5rem; gap: .25rem 1.5rem; padding: 1.1rem 0 1.2rem; border-bottom: 1px solid var(--rule); }
  .finding h4 { margin: 0; font: 600 1.05rem/1.35 var(--text); }
  .finding .plain { margin: .3rem 0 0; }
  .finding blockquote { margin: .7rem 0 0; padding: .1rem 0 .1rem 1rem; border-left: 1px solid var(--gilt); font-style: italic; white-space: pre-wrap; overflow-wrap: anywhere; }
  .finding .from { display: block; margin-top: .25rem; font-style: normal; font-variant-caps: all-small-caps; letter-spacing: .08em; color: var(--slate); font-size: .95rem; }
  .finding .review-note { margin: .6rem 0 0; color: var(--slate); font-size: .95rem; }
  .margin { grid-column: 2; grid-row: 1 / span 4; font-size: .85rem; line-height: 1.45; color: var(--slate); padding-top: .15rem; }
  details.group > summary { cursor: pointer; font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; padding-bottom: .55rem; border-bottom: 1px solid var(--rule); list-style-position: inside; }
  details.group > summary::marker { color: var(--gilt); }
  .simple { list-style: none; margin: 0; padding: 0; }
  .simple li { display: flex; justify-content: space-between; gap: 1rem; padding: .55rem 0; border-bottom: 1px solid var(--rule); }
  .simple .cite { color: var(--slate); font-size: .85rem; text-align: right; }
  .fix-prompt > p { margin: .75rem 0 0; }
  .fix-prompt pre {
    margin: 1rem 0 0; padding: .1rem 0 .1rem 1rem; border-left: 1px solid var(--gilt);
    font: 400 .95rem/1.55 var(--text); white-space: pre-wrap; overflow-wrap: anywhere;
    max-height: 22rem; overflow: auto;
  }
  .fix-prompt-actions { display: flex; flex-wrap: wrap; gap: .75rem 1rem; align-items: center; margin-top: 1rem; }
  .closing { margin-top: 2.25rem; color: var(--slate); font-size: .95rem; }
  .closing p { margin: .35rem 0; }

  .postscript { font-size: .95rem; }
  .postscript h2 { font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin: 1.75rem 0 .5rem; }
  .postscript h2:first-child { margin-top: 0; }
  .postscript p { margin: .5rem 0; max-width: 65ch; }
  .limits { margin-top: 2.75rem; padding-top: 1.5rem; border-top: 1px solid var(--gilt); }
  .limits h2, .limits h3 { font: 500 .8rem/1.2 var(--engraved); letter-spacing: .16em; text-transform: uppercase; margin: 0 0 .5rem; }
  .letter .limits { font-size: .95rem; }
  .letter .limits p { margin: .5rem 0; max-width: 65ch; }
  .signature { margin: 2.5rem 0 .4rem; font: 600 1.1rem/1 var(--engraved); letter-spacing: .2em; color: var(--ink); }
  .signature::before { content: ''; display: block; width: 9rem; border-top: 1px solid var(--ink); margin-bottom: .7rem; }

  .actions { display: flex; flex-wrap: wrap; gap: 1rem 1.75rem; align-items: center; margin-top: 2.75rem; padding-top: 1.75rem; border-top: 1px solid var(--rule); }
  .actions-status { flex-basis: 100%; margin: 0; min-height: 1.6em; font-size: .95rem; font-style: italic; color: var(--slate); }
  .actions-status.error { color: var(--oxblood); font-style: normal; }

  @media (max-width: 34rem) {
    .key { grid-template-columns: 1fr; }
    .steps { margin-top: 1.25rem; }
    .steps li { margin: .35rem 0; }
    .entry { margin-top: 1.75rem; }
    .field { grid-template-columns: 1fr; }
    .field .btn { justify-self: start; }
    .field > .btn, .pages { grid-column: 1; grid-row: auto; }
    .finding { grid-template-columns: 1fr; }
    .margin { grid-column: 1; grid-row: auto; padding: .5rem 0 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
    .working .engraving { transform: scaleX(1); }
  }
  @media print {
    html, body { background: #fff; }
    body { padding: 0; min-height: 0; font-size: 11pt; }
    .sheet { max-width: none; padding: 0; box-shadow: none; }
    .actions, .fix-prompt { display: none; }
    body:has(.review-sheet:not([hidden])) .sheet:not(.review-sheet) { display: none; }
    .finding, .simple li { break-inside: avoid; }
    .group > h3, details.group > summary, .limits h3 { break-after: avoid; }
  }
  .has-review .reference .limits { display: none; }
  .home-link { display: inline-block; color: inherit; text-decoration: none; }
  .home-link:focus-visible { outline: 1px solid var(--gilt); outline-offset: .4rem; }
  .site-page h1 { margin: 1.5rem 0 1.25rem; font: 600 1.35rem/1.3 var(--text); }
  .site-page ul { margin: .5rem 0; padding-left: 1.2rem; max-width: 65ch; }
  .site-page li + li { margin-top: .35rem; }
  .site-footer { max-width: 44rem; margin: 1.5rem auto 2rem; padding: 0 1rem; text-align: center; font-size: .85rem; color: var(--slate); }
  .site-footer a { color: inherit; }
  .site-footer a + a::before { content: "·"; display: inline-block; margin: 0 .6em; color: var(--gilt); text-decoration: none; }
  @media print { .site-footer { display: none; } }
`;

export const SITE_FOOTER = `<footer class="site-footer"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a><a href="https://github.com/butchewing/itemized">Source</a></footer>`;

export const HEAD_LINKS = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cellipse cx='16' cy='16' rx='14' ry='15' fill='%23ffffff' stroke='%23a8864a' stroke-width='1.5'/%3E%3Cpath d='M12 9h8M12 23h8M16 9v14' stroke='%2320262e' stroke-width='2.2' fill='none'/%3E%3C/svg%3E">
<link rel="preload" href="/fonts/source-serif-4-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/cinzel-latin.woff2" as="font" type="font/woff2" crossorigin>
<style>${STYLES}</style>`;

export const MONOGRAM = `<svg class="monogram" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
      <ellipse cx="28" cy="28" rx="25.5" ry="26.5" stroke-width="1"/>
      <ellipse cx="28" cy="28" rx="22.5" ry="23.5" stroke-width=".5"/>
      <path d="M22 16.5h12M22 39.5h12M26 16.5v23M30 16.5v23M27 17v22M28 17v22M29 17v22" stroke-width="1"/>
    </svg>`;


// Review links share a generic card so a preview never names the funeral home.
export const socialMeta = (title: string, path = '/') => `<meta name="description" content="${DESCRIPTION}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Itemized">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Itemized letterhead beside a sample review of a fictional funeral home's price list, showing a finding with its Funeral Rule citation.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${DESCRIPTION}">
<meta name="twitter:image" content="${SITE}/og.png">
<meta name="twitter:image:alt" content="The Itemized letterhead beside a sample review of a fictional funeral home's price list, showing a finding with its Funeral Rule citation.">`;
