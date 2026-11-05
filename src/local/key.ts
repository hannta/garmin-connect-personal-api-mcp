// Finds and saves the Garmin key for the local server. The variable names and the file are
// the ones Garmin's own Personal API tools use, so a key saved by either works for both.

import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { GarminError } from '../garmin/errors';
import { MemoryStore } from '../garmin/store';
import { TokenProvider } from '../garmin/token';
import { writePrivateFile } from './file-store';

export const KEY_VARIABLE = 'GARMIN_PERSONAL_API_KEY';
export const KEY_FILE_VARIABLE = 'GARMIN_PERSONAL_API_KEY_FILE';

/** Where `auth` saves the key. */
export function keyFilePath(home: string = homedir()): string {
  return join(home, '.config', 'garmin', 'connect-personal-api-key');
}

export interface FoundKey {
  key: string;
  /** Where it came from, for messages. Never the key itself. */
  source: string;
}

function readKeyFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The key from the environment or the key file. Runs on every tool call. */
export function findKey(
  env: NodeJS.Dict<string> = process.env,
  home: string = homedir(),
): FoundKey | undefined {
  const fromVariable = env[KEY_VARIABLE]?.trim();
  if (fromVariable) return { key: fromVariable, source: KEY_VARIABLE };

  const path = env[KEY_FILE_VARIABLE]?.trim() || keyFilePath(home);
  const key = readKeyFile(path);
  return key ? { key, source: path } : undefined;
}

export async function saveKey(key: string, home: string = homedir()): Promise<string> {
  const path = keyFilePath(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writePrivateFile(path, `${key}\n`);
  return path;
}

/** Exchanges the key with Garmin. Returns what's wrong with it, or undefined if it works. */
export async function checkKey(key: string, fetchFn?: typeof fetch): Promise<string | undefined> {
  // An HTTP header can't carry anything else, and a paste can.
  if (!/^[\x21-\x7e]+$/.test(key)) return "That doesn't look like a Garmin Personal API key.";
  try {
    const tokens = new TokenProvider({
      apiKey: key,
      store: new MemoryStore(),
      ...(fetchFn && { fetch: fetchFn }),
    });
    await tokens.getToken({ forceRefresh: true });
    return undefined;
  } catch (error) {
    return error instanceof GarminError ? error.message : 'Could not check the key with Garmin.';
  }
}
