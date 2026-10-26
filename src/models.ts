import type { Provider } from './audit';

type ProviderConfig = {
  baseUrl: string;
  model: string;
  // How the model is named to readers of a review.
  displayName: string;
  keyName: 'META_API_KEY' | 'BASETEN_API_KEY';
  authHeader: (key: string) => Record<string, string>;
  // Baseten documents Muse Spark Open as not supporting structured outputs.
  jsonSchema: boolean;
  // Images one request may carry.
  maxImages: number;
};

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

export const PROVIDER_CONFIG: Record<Provider, ProviderConfig> = {
  'meta-api': {
    baseUrl: 'https://api.meta.ai/v1',
    model: 'muse-spark-1.3',
    displayName: 'Muse Spark 1.3',
    keyName: 'META_API_KEY',
    authHeader: bearer,
    jsonSchema: true,
    // prep/meta-api-facts.md
    maxImages: 50,
  },
  'open-weights': {
    baseUrl: 'https://inference.baseten.co/v1',
    model: 'meta-models/muse-spark-open-1026',
    displayName: 'Muse Spark Open',
    keyName: 'BASETEN_API_KEY',
    authHeader: bearer,
    jsonSchema: false,
    // docs.baseten.co/inference/model-apis/vision, Muse Spark Open column (read 2026-10-26)
    maxImages: 8,
  },
};

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
};

export class ModelError extends Error {
  constructor(
    readonly provider: Provider,
    readonly status: number,
    readonly body: string,
    // Set when the call was billed but its output was unusable.
    readonly usage?: Usage,
  ) {
    super(`${provider} responded ${status}: ${body}`);
  }
}

const truncate = (s: string, n = 800) => (s.length > n ? `${s.slice(0, n)}...[truncated]` : s);

export function toDataUrl(bytes: ArrayBuffer, mime: string): string {
  let bin = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

// $ per 1M tokens. Meta Standard per prep/meta-api-facts.md; Baseten Model API per baseten.co/library/muse-spark-open.
const TOKEN_PRICES: Record<Provider, { input: number; cached: number; output: number }> = {
  'meta-api': { input: 1.25, cached: 0.15, output: 4.25 },
  'open-weights': { input: 1.25, cached: 0.15, output: 4.25 },
};
export const SAM_PER_IMAGE_USD = 2.5 / 1000;

// Reasoning tokens are already inside outputTokens.
export function costUsd(provider: Provider, u: Usage): number {
  const p = TOKEN_PRICES[provider];
  return ((u.inputTokens - u.cachedTokens) * p.input + u.cachedTokens * p.cached + u.outputTokens * p.output) / 1e6;
}

export type ChatJsonOptions = {
  system: string;
  parts: ContentPart[];
  schema: Record<string, unknown>;
  reasoningEffort?: ReasoningEffort;
  model?: string;
  // 'prompt' puts the schema in the system prompt instead of response_format.
  structured?: 'json_schema' | 'prompt';
};

export async function chatJson(env: Env, provider: Provider, opts: ChatJsonOptions) {
  const cfg = PROVIDER_CONFIG[provider];
  const key = env[cfg.keyName];
  if (!key) throw new ModelError(provider, 0, `${cfg.keyName} is not set`);
  const model = opts.model ?? cfg.model;
  const structured = opts.structured ?? (cfg.jsonSchema ? 'json_schema' : 'prompt');

  const system =
    structured === 'prompt'
      ? `${opts.system}\nReply with only a JSON object matching this JSON Schema, no prose, no code fences:\n${JSON.stringify(opts.schema)}`
      : opts.system;
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: opts.parts },
    ],
    ...(opts.reasoningEffort && { reasoning_effort: opts.reasoningEffort }),
    ...(structured === 'json_schema' && {
      response_format: { type: 'json_schema', json_schema: { name: 'extraction', strict: true, schema: opts.schema } },
    }),
  };

  const t0 = Date.now();
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cfg.authHeader(key) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) throw new ModelError(provider, res.status, truncate(text));

  const data = JSON.parse(text) as {
    model?: string;
    choices: { message: { content: string | null } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  const u = data.usage ?? {};
  const usage: Usage = {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
  const content = data.choices[0]?.message.content ?? '';
  let json: unknown;
  try {
    json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new ModelError(provider, res.status, `unparseable JSON content: ${truncate(content)}`, usage);
  }
  return { json, usage, ms, model: data.model ?? model };
}

export type SamBox = { ordinal: number; x1: number; y1: number; x2: number; y2: number; w: number; h: number };

const BOX = /(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g;

// Masks are left undecoded: they need @meta-sam/parser.
export async function sam(env: Env, imageBytes: ArrayBuffer, mime: string, phrase: string) {
  const key = env.META_API_KEY;
  if (!key) throw new ModelError('meta-api', 0, 'META_API_KEY is not set');
  const t0 = Date.now();
  const res = await fetch(`${PROVIDER_CONFIG['meta-api'].baseUrl}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...PROVIDER_CONFIG['meta-api'].authHeader(key) },
    body: JSON.stringify({
      model: 'sam-3.1',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: phrase },
            { type: 'input_image', image_url: toDataUrl(imageBytes, mime) },
          ],
        },
      ],
    }),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) throw new ModelError('meta-api', res.status, truncate(text));

  const data = JSON.parse(text) as {
    output_text?: string;
    output?: { content?: { type: string; text?: string }[] }[];
    usage?: unknown;
  };
  const raw =
    data.output_text ??
    data.output?.flatMap((o) => o.content ?? []).map((c) => c.text ?? '').join('') ??
    '';
  const boxes: SamBox[] = [...raw.matchAll(BOX)].map((m) => ({
    ordinal: +m[1]!, x1: +m[2]!, y1: +m[3]!, x2: +m[4]!, y2: +m[5]!, w: +m[6]!, h: +m[7]!,
  }));
  return { raw: truncate(raw.replace(/<\|mask;[^|]*\|>/g, '<mask>'), 2000), boxes, usage: data.usage, ms };
}
