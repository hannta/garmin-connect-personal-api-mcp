// Errors from the Garmin client. Messages are safe to show to the user and to Claude:
// they never contain the API key, the access token or response bodies.

export type GarminErrorCode =
  | 'missing_key'
  | 'invalid_key'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'upstream'
  | 'network'
  | 'invalid_response';

export class GarminError extends Error {
  override name = 'GarminError';

  constructor(
    readonly code: GarminErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function errorFromStatus(
  status: number,
  what: string,
  retryAfter?: string | null,
): GarminError {
  if (status === 401 || status === 403) {
    return new GarminError(
      'unauthorized',
      `Garmin rejected the request for ${what} (HTTP ${status}).`,
      status,
    );
  }
  if (status === 404) {
    return new GarminError('not_found', `Garmin has no data for ${what} (HTTP 404).`, status);
  }
  if (status === 429) {
    const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
    return new GarminError(
      'rate_limited',
      `Garmin rate limit reached for ${what}${Number.isFinite(seconds) ? `; retry after ${seconds} s` : ''}.`,
      status,
      Number.isFinite(seconds) ? seconds : undefined,
    );
  }
  return new GarminError('upstream', `Garmin returned HTTP ${status} for ${what}.`, status);
}
