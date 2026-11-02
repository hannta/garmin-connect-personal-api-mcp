// Failed-login lockout, counted in KV: per client IP, plus a global counter against
// attempts spread over many IPs. A lockout only blocks new sign-ins; connected clients
// keep working. KV is eventually consistent, so the limits are approximate.

import type { KeyValueStore } from '../garmin/store';

export const LOCKOUT = {
  perIpFailures: 5,
  globalFailures: 20,
  windowSeconds: 15 * 60,
} as const;

interface Counter {
  failures: number;
  /** Epoch ms when the window started; the counter expires with it. */
  since: number;
}

export class LoginLockout {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until sign-in is allowed again for this IP, or 0 when it isn't locked. */
  async lockedFor(ip: string): Promise<number> {
    const [perIp, global] = await Promise.all([this.#read(ipKey(ip)), this.#read(GLOBAL_KEY)]);
    return Math.max(
      this.#remaining(perIp, LOCKOUT.perIpFailures),
      this.#remaining(global, LOCKOUT.globalFailures),
    );
  }

  async recordFailure(ip: string): Promise<void> {
    await Promise.all([this.#increment(ipKey(ip)), this.#increment(GLOBAL_KEY)]);
  }

  async recordSuccess(ip: string): Promise<void> {
    await this.store.put(ipKey(ip), JSON.stringify({ failures: 0, since: this.now() }), {
      expirationTtl: 60,
    });
  }

  #remaining(counter: Counter | null, limit: number): number {
    if (!counter || counter.failures < limit) return 0;
    const ends = counter.since + LOCKOUT.windowSeconds * 1000;
    return Math.max(Math.ceil((ends - this.now()) / 1000), 0);
  }

  async #read(key: string): Promise<Counter | null> {
    const raw = await this.store.get(key);
    if (!raw) return null;
    try {
      const counter = JSON.parse(raw) as Counter;
      const expired = counter.since + LOCKOUT.windowSeconds * 1000 <= this.now();
      return expired ? null : counter;
    } catch {
      return null;
    }
  }

  async #increment(key: string): Promise<void> {
    const current = await this.#read(key);
    const counter: Counter = current
      ? { failures: current.failures + 1, since: current.since }
      : { failures: 1, since: this.now() };
    const remaining = Math.ceil((counter.since + LOCKOUT.windowSeconds * 1000 - this.now()) / 1000);
    // KV requires a TTL of at least 60 seconds.
    await this.store.put(key, JSON.stringify(counter), { expirationTtl: Math.max(remaining, 60) });
  }
}

const GLOBAL_KEY = 'auth:failures:global';

function ipKey(ip: string): string {
  return `auth:failures:ip:${ip}`;
}
