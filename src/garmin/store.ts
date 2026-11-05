// Minimal key-value interface for caches. A Workers KVNamespace satisfies it directly, and
// src/local/file-store.ts is the local server's version. MemoryStore is used by tests and
// scripts.

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  readonly #entries = new Map<string, { value: string; expiresAt?: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): Promise<string | null> {
    const entry = this.#entries.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt =
      options?.expirationTtl === undefined ? undefined : this.now() + options.expirationTtl * 1000;
    this.#entries.set(key, expiresAt === undefined ? { value } : { value, expiresAt });
    return Promise.resolve();
  }
}
