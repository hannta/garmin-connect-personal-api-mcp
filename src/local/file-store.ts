// The local server's KeyValueStore: one private file per key, in the cache directory. One
// file per key and a rename on write, because each MCP client starts its own server
// process and they all share this directory.

import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { KeyValueStore } from '../garmin/store';

interface Entry {
  value: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
}

export function cacheDirectory(
  env: NodeJS.Dict<string> = process.env,
  home: string = homedir(),
): string {
  return join(env.XDG_CACHE_HOME || join(home, '.cache'), 'garmin-connect-personal-api-mcp');
}

/** Writes a private file in one step: readers see the old content or the new, never part. */
export async function writePrivateFile(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export class FileStore implements KeyValueStore {
  constructor(
    private readonly directory: string,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string): Promise<string | null> {
    const entry = await this.#read(this.#path(key));
    if (!entry) return null;
    if (this.#isExpired(entry)) {
      await rm(this.#path(key), { force: true }).catch(() => undefined);
      return null;
    }
    return entry.value;
  }

  /** A cache that can't be written must not fail the tool call, so this only logs. */
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const entry: Entry = { value };
    if (options?.expirationTtl !== undefined) {
      entry.expiresAt = this.now() + options.expirationTtl * 1000;
    }
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      await writePrivateFile(this.#path(key), JSON.stringify(entry));
    } catch (error) {
      console.error('Could not write the cache:', error instanceof Error ? error.message : error);
    }
  }

  /** Deletes expired entries, including ones that are never read again. */
  async prune(): Promise<void> {
    const names = await readdir(this.directory).catch(() => [] as string[]);
    for (const name of names) {
      const path = join(this.directory, name);
      if (name.endsWith('.tmp')) continue;
      const entry = await this.#read(path);
      if (entry && this.#isExpired(entry)) await rm(path, { force: true }).catch(() => undefined);
    }
  }

  #path(key: string): string {
    return join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  #isExpired(entry: Entry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= this.now();
  }

  async #read(path: string): Promise<Entry | undefined> {
    try {
      const entry = JSON.parse(await readFile(path, 'utf8')) as Partial<Entry>;
      if (typeof entry.value !== 'string') return undefined;
      return entry as Entry;
    } catch {
      return undefined; // missing or corrupt: same as not cached
    }
  }
}
