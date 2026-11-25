import { describe, expect, it } from 'vitest';
import { endpoint, workersAiGateway } from '../src/models';

const env = (vars: Partial<Env>) => vars as Env;
const GW = 'https://gateway.ai.cloudflare.com/v1/acct/itemized';

describe('AI Gateway routing', () => {
  it('calls providers directly when no gateway is set', () => {
    expect(endpoint(env({}), 'meta-api')).toEqual({ baseUrl: 'https://api.meta.ai/v1', headers: {} });
    expect(endpoint(env({}), 'ollama-mistral').baseUrl).toBe('https://ollama.com/v1');
  });

  it('routes through the gateway with payload logging off', () => {
    const meta = endpoint(env({ AI_GATEWAY_URL: `${GW}/`, CF_AIG_TOKEN: 't' }), 'meta-api');
    expect(meta.baseUrl).toBe(`${GW}/custom-meta/v1`);
    expect(meta.headers).toEqual({ 'cf-aig-collect-log-payload': 'false', 'cf-aig-authorization': 'Bearer t' });
    expect(endpoint(env({ AI_GATEWAY_URL: GW }), 'ollama-mistral')).toEqual({
      baseUrl: `${GW}/custom-ollama/v1`,
      headers: { 'cf-aig-collect-log-payload': 'false' },
    });
  });

  it('sends Workers AI calls to the same gateway, unlogged, and direct without one', () => {
    expect(workersAiGateway(env({ AI_GATEWAY_URL: `${GW}/` }))).toEqual({ gateway: { id: 'itemized', collectLog: false, skipCache: true } });
    expect(workersAiGateway(env({}))).toEqual({});
    expect(() => endpoint(env({ AI_GATEWAY_URL: GW }), 'muse-open')).toThrow(/Workers AI binding/);
  });
});
