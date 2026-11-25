import Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import type { Provider } from './audit';

type Common = {
  model: string;
  // How the model is named to readers of a review.
  displayName: string;
  // false: the schema goes in the system prompt instead of response_format.
  jsonSchema: boolean;
  // Images one request may carry.
  maxImages: number;
  // Takes a PDF as a file part; otherwise uploads must be photos or page images.
  pdf: boolean;
  // Accepts reasoning_effort (or Anthropic's effort).
  reasoning: boolean;
};

type ProviderConfig = Common &
  (
    | {
        // 'chat': OpenAI-style /chat/completions. 'anthropic': the Anthropic SDK's Messages API.
        api: 'chat' | 'anthropic';
        // Called directly when AI_GATEWAY_URL is unset (the portable config and forks).
        baseUrl: string;
        // The same base under Cloudflare AI Gateway: AI_GATEWAY_URL + '/' + gatewayPath.
        gatewayPath: string;
        keyName: 'META_API_KEY' | 'ANTHROPIC_API_KEY' | 'OLLAMA_API_KEY';
        authHeader: (key: string) => Record<string, string>;
      }
    | {
        // The Workers AI binding (env.AI): no key, billed to the account. Third-party models such as
        // Muse Spark Open spend Unified Billing credits; @cf models run on Cloudflare.
        api: 'workers-ai';
      }
  );

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

const anthropicModel = (model: string, displayName: string): ProviderConfig => ({
  api: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  gatewayPath: 'anthropic',
  model,
  displayName,
  keyName: 'ANTHROPIC_API_KEY',
  authHeader: (key) => ({ 'x-api-key': key }),
  jsonSchema: true,
  // MAX_PAGES is 10, so every list goes in one request.
  maxImages: 20,
  pdf: true,
  reasoning: true,
});

// Cloudflare-hosted open models: Vision and Zero data retention per their catalog pages (read 2026-11-24).
const cloudflareHosted = (model: string, displayName: string, reasoning: boolean): ProviderConfig => ({
  api: 'workers-ai',
  model,
  displayName,
  jsonSchema: true,
  maxImages: 8,
  pdf: false,
  reasoning,
});

export const PROVIDER_CONFIG: Record<Provider, ProviderConfig> = {
  'meta-api': {
    api: 'chat',
    baseUrl: 'https://api.meta.ai/v1',
    // A gateway custom provider with slug "meta" and base_url https://api.meta.ai.
    gatewayPath: 'custom-meta/v1',
    model: 'muse-spark-1.3',
    displayName: 'Muse Spark 1.3',
    keyName: 'META_API_KEY',
    authHeader: bearer,
    jsonSchema: true,
    // prep/meta-api-facts.md
    maxImages: 50,
    pdf: true,
    reasoning: true,
  },
  // Meta's open weights, served by Fireworks through Cloudflare (catalog: third-party, Unified Billing).
  // Replaces the Baseten deployment, deactivated by 2026-11-24. Fireworks ToS 3.6: zero data retention,
  // no training on Content. The only provider real price lists may reach in the eval (test/eval/sets.mjs).
  'muse-open': {
    api: 'workers-ai',
    model: 'meta/muse-spark-open',
    displayName: 'Muse Spark Open',
    jsonSchema: true,
    maxImages: 8,
    pdf: false,
    reasoning: true,
  },
  // Evaluated beside Muse Spark (EVAL.md); production stays on MODEL_PROVIDER meta-api.
  'gemma-4': cloudflareHosted('@cf/google/gemma-4-26b-a4b-it', 'Gemma 4 26B', true),
  'llama-4-scout': cloudflareHosted('@cf/meta/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', false),
  'qwen-3.8': cloudflareHosted('@cf/qwen/qwen3.8-27b', 'Qwen 3.8 27B', true),
  // Ollama Cloud through a gateway custom provider (slug "ollama", base_url https://ollama.com).
  // Its cloud models do not support structured outputs (docs.ollama.com/cloud, read 2026-11-24).
  'ollama-mistral': {
    api: 'chat',
    baseUrl: 'https://ollama.com/v1',
    gatewayPath: 'custom-ollama/v1',
    model: 'mistral-large-4',
    displayName: 'Mistral Large 4 (Ollama Cloud)',
    keyName: 'OLLAMA_API_KEY',
    authHeader: bearer,
    jsonSchema: false,
    maxImages: 8,
    pdf: false,
    reasoning: false,
  },
  'claude-sonnet': anthropicModel('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
  'claude-haiku': anthropicModel('claude-haiku-5-5', 'Claude Haiku 5.5'),
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

// Every model call goes through AI Gateway when AI_GATEWAY_URL is set. The gateway keeps metadata
// only (tokens, cost, latency, status): uploads never land in its logs, so the 30-day deletion holds.
export function endpoint(env: Env, provider: Provider): { baseUrl: string; headers: Record<string, string> } {
  const cfg = PROVIDER_CONFIG[provider];
  if (cfg.api === 'workers-ai') throw new Error(`${provider} runs on the Workers AI binding, not a URL`);
  const gateway = env.AI_GATEWAY_URL?.replace(/\/+$/, '');
  if (!gateway) return { baseUrl: cfg.baseUrl, headers: {} };
  return {
    baseUrl: `${gateway}/${cfg.gatewayPath}`,
    headers: {
      'cf-aig-collect-log-payload': 'false',
      ...(env.CF_AIG_TOKEN && { 'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}` }),
    },
  };
}

const truncate = (s: string, n = 800) => (s.length > n ? `${s.slice(0, n)}...[truncated]` : s);

export function toDataUrl(bytes: ArrayBuffer, mime: string): string {
  let bin = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

// $ per 1M tokens. Meta Standard per prep/meta-api-facts.md; Baseten Model API per baseten.co/library/muse-spark-open;
// Claude per Anthropic's price list (read 2026-11-23). Claude calls set no cache_control, so `cached` stays unused there.
const TOKEN_PRICES: Record<Provider, { input: number; cached: number; output: number }> = {
  'meta-api': { input: 1.25, cached: 0.15, output: 4.25 },
  // Catalog prices, read 2026-11-24 (developers.cloudflare.com/ai/models, ollama.com/pricing). Where no
  // cached-input price is listed, cached tokens are charged as input.
  'muse-open': { input: 1.25, cached: 0.15, output: 4.25 },
  'gemma-4': { input: 0.1, cached: 0.1, output: 0.3 },
  'llama-4-scout': { input: 0.27, cached: 0.27, output: 0.85 },
  'qwen-3.8': { input: 0.45, cached: 0.05, output: 3.2 },
  'ollama-mistral': { input: 0.7, cached: 0.7, output: 2.1 },
  'claude-sonnet': { input: 2, cached: 0.1, output: 10 },
  'claude-haiku': { input: 0.1, cached: 0.01, output: 0.5 },
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

type ChatCompletion = {
  model?: string;
  choices?: { message: { content: string | object | null } }[];
  // Older Workers AI models answer { response, usage } instead of choices.
  response?: string | object;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

// The OpenAI-style request shared by /chat/completions and the Workers AI binding.
function chatRequest(cfg: ProviderConfig, opts: ChatJsonOptions) {
  const structured = opts.structured ?? (cfg.jsonSchema ? 'json_schema' : 'prompt');
  const system =
    structured === 'prompt'
      ? `${opts.system}\nReply with only a JSON object matching this JSON Schema, no prose, no code fences:\n${JSON.stringify(opts.schema)}`
      : opts.system;
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: opts.parts },
    ],
    ...(opts.reasoningEffort && cfg.reasoning && { reasoning_effort: opts.reasoningEffort }),
    ...(structured === 'json_schema' && {
      response_format: { type: 'json_schema', json_schema: { name: 'extraction', strict: true, schema: opts.schema } },
    }),
  };
}

function parseCompletion(provider: Provider, status: number, data: ChatCompletion) {
  const u = data.usage ?? {};
  const usage: Usage = {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
  const raw = data.choices?.[0]?.message.content ?? data.response ?? '';
  if (typeof raw === 'object') return { json: raw as unknown, usage };
  try {
    return { json: JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) as unknown, usage };
  } catch {
    throw new ModelError(provider, status, `unparseable JSON content: ${truncate(raw)}`, usage);
  }
}

export async function chatJson(env: Env, provider: Provider, opts: ChatJsonOptions) {
  const cfg = PROVIDER_CONFIG[provider];
  const model = opts.model ?? cfg.model;
  if (cfg.api === 'workers-ai') return workersAiJson(env, provider, model, opts);
  const key = env[cfg.keyName];
  if (!key) throw new ModelError(provider, 0, `${cfg.keyName} is not set`);
  if (cfg.api === 'anthropic') return claudeJson(env, provider, key, model, opts);

  const { baseUrl, headers } = endpoint(env, provider);
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers, ...cfg.authHeader(key) },
    body: JSON.stringify({ model, ...chatRequest(cfg, opts) }),
  });
  const text = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) throw new ModelError(provider, res.status, truncate(text));
  const data = JSON.parse(text) as ChatCompletion;
  return { ...parseCompletion(provider, res.status, data), ms, model: data.model ?? model };
}

// The gateway id is the last segment of AI_GATEWAY_URL. The binding has no metadata-only option, so
// these calls are not logged at all (collectLog: false); model_calls still records cost and latency.
export function workersAiGateway(env: Env) {
  const id = env.AI_GATEWAY_URL?.replace(/\/+$/, '').split('/').at(-1);
  return id ? { gateway: { id, collectLog: false, skipCache: true } } : {};
}

async function workersAiJson(env: Env, provider: Provider, model: string, opts: ChatJsonOptions) {
  const cfg = PROVIDER_CONFIG[provider];
  const t0 = Date.now();
  let data: ChatCompletion;
  try {
    // The binding's per-model input types do not cover every catalog model, so the request is untyped.
    data = (await (env.AI.run as (m: string, i: unknown, o: unknown) => Promise<unknown>)(
      model,
      { ...chatRequest(cfg, opts), max_tokens: 16000 },
      workersAiGateway(env),
    )) as ChatCompletion;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Status 400 for input errors keeps the pipeline's reasoning-effort fallback working.
    throw new ModelError(provider, /invalid|unsupported|reasoning|bad input|400/i.test(message) ? 400 : 502, truncate(message));
  }
  return { ...parseCompletion(provider, 200, data), ms: Date.now() - t0, model };
}

// Anthropic's schema transform keeps an object's properties only when `type` is the string 'object',
// so nullable types (['object', 'null']) become anyOf first.
export function claudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(claudeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, claudeSchema(v)]));
  const type = out.type;
  if (Array.isArray(type) && type.length === 2 && type.includes('null')) {
    const { type: _, ...rest } = out;
    return { anyOf: [{ ...rest, type: type.find((t) => t !== 'null') }, { type: 'null' }] };
  }
  return out;
}

const DATA_URL = /^data:([^;]+);base64,(.*)$/s;

function claudeContent(parts: ContentPart[]): Anthropic.ContentBlockParam[] {
  return parts.map((p): Anthropic.ContentBlockParam => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    const url = p.type === 'file' ? p.file.file_data : p.image_url.url;
    const [, mime, data] = url.match(DATA_URL) ?? [];
    if (!mime || !data) throw new Error('Claude parts must be base64 data URLs');
    if (p.type === 'file') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
    return { type: 'image', source: { type: 'base64', media_type: mime as Anthropic.Base64ImageSource['media_type'], data } };
  });
}

// Claude has no 'minimal'; transcription runs at 'low'.
const claudeEffort = (e: ReasoningEffort | undefined) => (e === undefined || e === 'minimal' ? 'low' : e);

async function claudeJson(env: Env, provider: Provider, key: string, model: string, opts: ChatJsonOptions) {
  const { baseUrl, headers } = endpoint(env, provider);
  const client = new Anthropic({ apiKey: key, baseURL: baseUrl, defaultHeaders: headers });
  const t0 = Date.now();
  let message: Anthropic.Message;
  try {
    // Streamed so a long multi-page transcription is not cut off by a request timeout.
    message = await client.messages
      .stream({
        model,
        max_tokens: 32000,
        system: opts.system,
        messages: [{ role: 'user', content: claudeContent(opts.parts) }],
        output_config: {
          effort: claudeEffort(opts.reasoningEffort),
          format: { type: 'json_schema', schema: transformJSONSchema(claudeSchema(opts.schema) as Record<string, unknown>) },
        },
      })
      .finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new ModelError(provider, e.status ?? 0, truncate(e.message));
    throw e;
  }
  const ms = Date.now() - t0;
  const u = message.usage;
  const cached = u.cache_read_input_tokens ?? 0;
  const usage: Usage = {
    // Anthropic counts cache reads and writes apart from input_tokens; costUsd expects them inside.
    inputTokens: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens,
    reasoningTokens: 0,
    cachedTokens: cached,
  };
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
    throw new ModelError(provider, 200, `stop_reason ${message.stop_reason}`, usage);
  }
  const content = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    throw new ModelError(provider, 200, `unparseable JSON content: ${truncate(content)}`, usage);
  }
  return { json, usage, ms, model: message.model };
}

export type SamBox = { ordinal: number; x1: number; y1: number; x2: number; y2: number; w: number; h: number };

const BOX = /(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g;

// Masks are left undecoded: they need @meta-sam/parser.
export async function sam(env: Env, imageBytes: ArrayBuffer, mime: string, phrase: string) {
  const key = env.META_API_KEY;
  if (!key) throw new ModelError('meta-api', 0, 'META_API_KEY is not set');
  const { baseUrl, headers } = endpoint(env, 'meta-api');
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers, ...bearer(key) },
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
