import { describe, expect, it } from 'vitest';
import worker from '../src/index';

// GHSA-h7mg-cq63-vhpq: hono <= 4.13.15 could skip wildcard middleware such as the /dev/* gate.
const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://itemized.mortuary.ai${path}`, init), {} as Env, {} as ExecutionContext);

describe('development routes stay closed without DEV_ROUTES', () => {
  for (const path of ['/dev/provider', '/dev/spend', '/dev/eval/x', '/dev/provider%0A', '/dev/provider%0D', '/dev/%E2%80%A8provider']) {
    it(`GET ${path} is 404`, async () => {
      expect((await call(path)).status).toBe(404);
    });
  }

  it('POST /dev/spike is 404', async () => {
    expect((await call('/dev/spike', { method: 'POST', body: new FormData() })).status).toBe(404);
  });
});
