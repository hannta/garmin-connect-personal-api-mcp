// OWNER_PASSPHRASE checks. Comparison is on SHA-256 digests in constant time, so timing
// reveals neither the passphrase nor its length. Grants store a fingerprint of the
// passphrase they were issued under; rotating the passphrase invalidates them.

export const MIN_PASSPHRASE_LENGTH = 16;

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

/** Whether the configured passphrase is usable: set and long enough. */
export function isPassphraseConfigured(configured: string | undefined): configured is string {
  return typeof configured === 'string' && configured.length >= MIN_PASSPHRASE_LENGTH;
}

export async function passphraseMatches(
  input: string,
  configured: string | undefined,
): Promise<boolean> {
  if (!isPassphraseConfigured(configured)) return false;
  const [a, b] = await Promise.all([sha256(input), sha256(configured)]);
  return constantTimeEqual(a, b);
}

/** A short, non-reversible identifier of the passphrase, stored in grant props. */
export async function passphraseFingerprint(configured: string | undefined): Promise<string> {
  const digest = await sha256(`grant-fingerprint:${configured ?? ''}`);
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
