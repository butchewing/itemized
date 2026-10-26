// Local-only flag passed as `wrangler dev --var DEV_ROUTES:1`; never set in production config.
interface Env {
  DEV_ROUTES?: string;
}
