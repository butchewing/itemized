// Local-only flag passed as `wrangler dev --var DEV_ROUTES:1`; never set in production config.
// AI_GATEWAY_URL (https://gateway.ai.cloudflare.com/v1/<account>/<gateway>) routes model calls through
// Cloudflare AI Gateway; CF_AIG_TOKEN is that gateway's token. Both optional: unset means direct calls.
interface Env {
  DEV_ROUTES?: string;
  AI_GATEWAY_URL?: string;
  CF_AIG_TOKEN?: string;
  // Only the claude-* providers read it; they are evaluated locally, not used in production.
  ANTHROPIC_API_KEY?: string;
}
