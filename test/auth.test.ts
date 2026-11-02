import { describe, expect, it } from 'vitest';
import { LOCKOUT, LoginLockout } from '../src/auth/lockout';
import {
  isPassphraseConfigured,
  passphraseFingerprint,
  passphraseMatches,
} from '../src/auth/passphrase';
import { MemoryStore } from '../src/garmin/store';

describe('passphrase', () => {
  const configured = 'a long enough passphrase';

  it('matches only the exact passphrase', async () => {
    expect(await passphraseMatches(configured, configured)).toBe(true);
    expect(await passphraseMatches(`${configured} `, configured)).toBe(false);
    expect(await passphraseMatches('', configured)).toBe(false);
  });

  it('refuses everything when the configured passphrase is missing or short', async () => {
    expect(isPassphraseConfigured(undefined)).toBe(false);
    expect(isPassphraseConfigured('short')).toBe(false);
    expect(await passphraseMatches('short', 'short')).toBe(false);
    expect(await passphraseMatches('', '')).toBe(false);
  });

  it('fingerprints change with the passphrase and never contain it', async () => {
    const a = await passphraseFingerprint(configured);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await passphraseFingerprint(configured)).toBe(a);
    expect(await passphraseFingerprint(`${configured}!`)).not.toBe(a);
  });
});

describe('login lockout', () => {
  function setup() {
    let now = Date.UTC(2026, 10, 2, 12);
    const store = new MemoryStore(() => now);
    const lockout = new LoginLockout(store, () => now);
    return { lockout, advance: (seconds: number) => (now += seconds * 1000) };
  }

  it('locks one IP after repeated failures, then unlocks after the window', async () => {
    const { lockout, advance } = setup();
    for (let i = 0; i < LOCKOUT.perIpFailures - 1; i++) await lockout.recordFailure('a');
    expect(await lockout.lockedFor('a')).toBe(0);

    await lockout.recordFailure('a');
    expect(await lockout.lockedFor('a')).toBe(LOCKOUT.windowSeconds);
    expect(await lockout.lockedFor('b')).toBe(0);

    advance(LOCKOUT.windowSeconds);
    expect(await lockout.lockedFor('a')).toBe(0);
  });

  it('locks everyone after many failures spread over IPs', async () => {
    const { lockout } = setup();
    for (let i = 0; i < LOCKOUT.globalFailures; i++) await lockout.recordFailure(`ip-${i}`);
    expect(await lockout.lockedFor('someone-new')).toBeGreaterThan(0);
  });

  it('resets an IP after a successful sign-in', async () => {
    const { lockout } = setup();
    for (let i = 0; i < LOCKOUT.perIpFailures - 1; i++) await lockout.recordFailure('a');
    await lockout.recordSuccess('a');
    await lockout.recordFailure('a');
    expect(await lockout.lockedFor('a')).toBe(0);
  });
});
