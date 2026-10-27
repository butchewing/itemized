import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module without types
import { assertSetAllowed, assertUploadAllowed, buildSets, CORPUS, CORPUS_PAGES, CORPUS_PROVIDER, GuardError } from './eval/sets.mjs';

type Set = { id: string; provider: string; private?: boolean; docs: { paths: string[] }[] };
const sets = buildSets() as Set[];
const page = join(CORPUS_PAGES, 'gpl-011', 'p01.png');

describe('real price lists only reach the open-weights provider', () => {
  it('the corpus provider is open-weights', () => {
    expect(CORPUS_PROVIDER).toBe('open-weights');
  });

  it('every set that includes a corpus file is private and declared open-weights', () => {
    for (const s of sets) {
      const touchesCorpus = s.docs.some((d) => d.paths.some((p) => p.startsWith(CORPUS)));
      if (touchesCorpus) expect({ id: s.id, private: s.private, provider: s.provider }).toEqual({ id: s.id, private: true, provider: 'open-weights' });
      expect(() => assertSetAllowed(s)).not.toThrow();
    }
  });

  it('refuses a private set declared on meta-api', () => {
    expect(() => assertSetAllowed({ id: 'x', provider: 'meta-api', private: true })).toThrow(GuardError);
  });

  it('refuses a corpus page when the Worker runs meta-api, even if the set says otherwise', () => {
    const lying = { id: 'x', provider: 'meta-api', private: true };
    expect(() => assertUploadAllowed(lying, [page], 'meta-api')).toThrow(/may only go to open-weights/);
  });

  it('refuses when the Worker provider differs from the set', () => {
    const corpus = sets.find((s) => s.private)!;
    expect(() => assertUploadAllowed(corpus, [page], 'meta-api')).toThrow(GuardError);
  });

  it('refuses a corpus file in a public set, and a corpus PDF anywhere', () => {
    expect(() => assertUploadAllowed({ id: 'a', provider: 'open-weights' }, [page], 'open-weights')).toThrow(/is public/);
    const pdf = join(CORPUS, 'gpl-011.pdf');
    expect(() => assertUploadAllowed({ id: 'f', provider: 'open-weights', private: true }, [pdf], 'open-weights')).toThrow(/rendered page image/);
  });

  it('allows corpus pages on open-weights and synthetic files on meta-api', () => {
    const corpus = sets.find((s) => s.private)!;
    expect(() => assertUploadAllowed(corpus, [page], 'open-weights')).not.toThrow();
    const a = sets.find((s) => s.id === 'a')!;
    expect(() => assertUploadAllowed(a, a.docs[0]!.paths, 'meta-api')).not.toThrow();
  });
});
