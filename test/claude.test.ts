import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import { describe, expect, it } from 'vitest';
import { EXTRACTION_SCHEMA } from '../src/extraction';
import { claudeSchema, endpoint } from '../src/models';
import { SEMANTIC_SCHEMA } from '../src/rules/semantic';

const forClaude = (schema: unknown) => transformJSONSchema(claudeSchema(schema) as Record<string, unknown>);
const walk = (node: unknown, visit: (o: Record<string, unknown>) => void) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((n) => walk(n, visit));
  }
};

describe('Claude structured-output schemas', () => {
  for (const [name, schema] of [['extraction', EXTRACTION_SCHEMA], ['semantic', SEMANTIC_SCHEMA]] as const) {
    it(`${name}: no type lists, no array-size limits, every object keeps its properties`, () => {
      const out = forClaude(schema);
      walk(out, (o) => {
        expect(Array.isArray(o.type)).toBe(false);
        expect(o).not.toHaveProperty('maxItems');
        if (o.type === 'object') {
          expect(o.additionalProperties).toBe(false);
          expect(o.properties).toBeDefined();
        }
      });
    });
  }

  it('turns a nullable object into anyOf without losing its properties', () => {
    const out = claudeSchema({ type: ['object', 'null'], properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false });
    expect(out).toEqual({
      anyOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }, { type: 'null' }],
    });
  });

  it('routes Claude through the gateway anthropic provider', () => {
    const gw = 'https://gateway.ai.cloudflare.com/v1/acct/itemized';
    expect(endpoint({ AI_GATEWAY_URL: gw } as Env, 'claude-sonnet').baseUrl).toBe(`${gw}/anthropic`);
    expect(endpoint({} as Env, 'claude-haiku').baseUrl).toBe('https://api.anthropic.com');
  });
});
