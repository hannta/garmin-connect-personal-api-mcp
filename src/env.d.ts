// Optional vars not declared in wrangler.jsonc, so `wrangler types` doesn't generate them.
interface Env {
  /** IANA time zone override, e.g. "Europe/Helsinki". Default: the Garmin profile. */
  TIMEZONE?: string;
}
