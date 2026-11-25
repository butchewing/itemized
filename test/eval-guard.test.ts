import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module without types
import { assertSetAllowed, assertUploadAllowed, buildSets, CORPUS, CORPUS_PAGES, CORPUS_PROVIDER, GuardError } from './eval/sets.mjs';

type Set = { id: string; provider: string; private?: boolean; docs: { paths: string[] }[] };
const sets = buildSets() as Set[];
const page = join(CORPUS_PAGES, 'gpl-011', 'p01.png');

describe('real price lists only reach the muse-open provider', () => {
  it('the corpus provider is muse-open', () => {
    expect(CORPUS_PROVIDER).toBe('muse-open');
  });

  it('every set that includes a corpus file is private and declared muse-open', () => {
    for (const s of sets) {
      const touchesCorpus = s.docs.some((d) => d.paths.some((p) => p.startsWith(CORPUS)));
      if (touchesCorpus) expect({ id: s.id, private: s.private, provider: s.provider }).toEqual({ id: s.id, private: true, provider: 'muse-open' });
      expect(() => assertSetAllowed(s)).not.toThrow();
    }
  });

  it('refuses a private set declared on any other provider', () => {
    for (const provider of ['claude-sonnet', 'claude-haiku', 'gemma-4', 'llama-4-scout', 'qwen-3.8', 'ollama-mistral']) expect(() => assertSetAllowed({ id: 'x', provider, private: true })).toThrow(GuardError);
  });

  it('every set not on the corpus provider is public and contains no corpus file', () => {
    for (const s of (buildSets() as Set[]).filter((x) => x.provider !== CORPUS_PROVIDER)) {
      expect(s.private).toBeFalsy();
      for (const d of s.docs) for (const p of d.paths) expect(p.startsWith(CORPUS)).toBe(false);
    }
  });

  it('refuses a private set declared on meta-api', () => {
    expect(() => assertSetAllowed({ id: 'x', provider: 'meta-api', private: true })).toThrow(GuardError);
  });

  it('refuses a corpus page when the Worker runs meta-api, even if the set says otherwise', () => {
    const lying = { id: 'x', provider: 'meta-api', private: true };
    expect(() => assertUploadAllowed(lying, [page], 'meta-api')).toThrow(/may only go to muse-open/);
  });

  it('refuses when the Worker provider differs from the set', () => {
    const corpus = sets.find((s) => s.private)!;
    expect(() => assertUploadAllowed(corpus, [page], 'meta-api')).toThrow(GuardError);
  });

  it('refuses a corpus file in a public set, and a corpus PDF anywhere', () => {
    expect(() => assertUploadAllowed({ id: 'a', provider: 'muse-open' }, [page], 'muse-open')).toThrow(/is public/);
    const pdf = join(CORPUS, 'gpl-011.pdf');
    expect(() => assertUploadAllowed({ id: 'f', provider: 'muse-open', private: true }, [pdf], 'muse-open')).toThrow(/rendered page image/);
  });

  it('allows corpus pages on muse-open and synthetic files on meta-api', () => {
    const corpus = sets.find((s) => s.private)!;
    expect(() => assertUploadAllowed(corpus, [page], 'muse-open')).not.toThrow();
    const a = sets.find((s) => s.id === 'a')!;
    expect(() => assertUploadAllowed(a, a.docs[0]!.paths, 'meta-api')).not.toThrow();
  });
});
