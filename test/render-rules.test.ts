import { describe, expect, it } from 'vitest';
import { RENDER_VERSION, type RenderInfo } from '../src/audit';
import { PROMPT_VERSION } from '../src/extraction';
import { ruleInput } from '../src/pipeline';
import { extractionVersion, PIPELINE_VERSIONS } from '../src/store';

const render = (textChars: number[]): RenderInfo => ({ version: RENDER_VERSION, pages: textChars.length, textChars });

describe('which rules a read gets (decided 2026-11-25)', () => {
  it('photos always get the photo rule', () => {
    expect(ruleInput('meta-api', 'pages', null)).toBe('images');
    expect(ruleInput('muse-open', 'pages', null)).toBe('images');
  });

  it('a PDF the model reads natively gets the PDF rules', () => {
    expect(ruleInput('meta-api', 'pdf', null)).toBe('pdf');
  });

  it('a rendered born-digital PDF read in one request gets the PDF rules', () => {
    expect(ruleInput('muse-open', 'pdf', render([2217, 2297]))).toBe('pdf');
    expect(ruleInput('muse-open', 'pdf', render(Array(8).fill(900)))).toBe('pdf');
  });

  it('a rendered PDF read in batches, or with a scanned page, gets the photo rule', () => {
    expect(ruleInput('muse-open', 'pdf', render(Array(9).fill(900)))).toBe('images');
    expect(ruleInput('muse-open', 'pdf', render(Array(19).fill(900)))).toBe('images');
    expect(ruleInput('muse-open', 'pdf', render([1200, 0]))).toBe('images');
  });

  it('a rendered PDF with no render record falls back to the photo rule', () => {
    expect(ruleInput('muse-open', 'pdf', null)).toBe('images');
  });
});

describe('cache keys for rendered reads', () => {
  it('include the renderer only when a PDF had to be rendered', () => {
    expect(extractionVersion('meta-api', 'pdf')).toBe(PROMPT_VERSION);
    expect(extractionVersion('muse-open', 'pages')).toBe(PROMPT_VERSION);
    expect(extractionVersion('muse-open', 'pdf')).toBe(`${PROMPT_VERSION}|${RENDER_VERSION}`);
  });

  it('a renderer change stops reuse of finished audits', () => {
    expect(PIPELINE_VERSIONS.endsWith(`|${RENDER_VERSION}`)).toBe(true);
  });
});
