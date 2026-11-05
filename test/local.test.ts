import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectKey } from '../src/local/auth-page';
import { cacheDirectory, FileStore } from '../src/local/file-store';
import { checkKey, findKey, keyFilePath, saveKey } from '../src/local/key';

const posixOnly = process.platform === 'win32' ? it.skip : it;

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'garmin-mcp-test-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('FileStore', () => {
  it('reads back what was written, including keys with any characters', async () => {
    const store = new FileStore(join(directory, 'new', 'cache'));
    await store.put('garmin:laps:v1:1/2', 'value');
    expect(await store.get('garmin:laps:v1:1/2')).toBe('value');
    expect(await store.get('missing')).toBeNull();
  });

  it('forgets entries when they expire', async () => {
    let now = 1000;
    const store = new FileStore(directory, () => now);
    await store.put('key', 'value', { expirationTtl: 60 });
    now += 59_000;
    expect(await store.get('key')).toBe('value');
    now += 1000;
    expect(await store.get('key')).toBeNull();
    expect(readdirSync(directory)).toEqual([]);
  });

  it('prunes expired entries and keeps the rest', async () => {
    let now = 1000;
    const store = new FileStore(directory, () => now);
    await store.put('short', 'value', { expirationTtl: 60 });
    await store.put('long', 'value', { expirationTtl: 600 });
    await store.put('forever', 'value');
    now += 120_000;
    await store.prune();
    expect(readdirSync(directory)).toHaveLength(2);
    expect(await store.get('long')).toBe('value');
    expect(await store.get('forever')).toBe('value');
  });

  it('treats a corrupt entry as not cached', async () => {
    const store = new FileStore(directory);
    await store.put('key', 'value');
    const [name] = readdirSync(directory);
    writeFileSync(join(directory, name as string), 'not json');
    expect(await store.get('key')).toBeNull();
  });

  it('does not fail when the cache cannot be written', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const file = join(directory, 'a-file');
    writeFileSync(file, '');
    const store = new FileStore(join(file, 'cache'));
    await expect(store.put('key', 'value')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  posixOnly('keeps entries private', async () => {
    const cache = join(directory, 'cache');
    const store = new FileStore(cache);
    await store.put('key', 'value');
    const [name] = readdirSync(cache);
    expect(statSync(cache).mode & 0o777).toBe(0o700);
    expect(statSync(join(cache, name as string)).mode & 0o777).toBe(0o600);
  });

  it('follows XDG_CACHE_HOME when it is set', () => {
    expect(cacheDirectory({}, '/home/me')).toBe(
      join('/home/me', '.cache', 'garmin-connect-personal-api-mcp'),
    );
    expect(cacheDirectory({ XDG_CACHE_HOME: '/cache' }, '/home/me')).toBe(
      join('/cache', 'garmin-connect-personal-api-mcp'),
    );
  });
});

describe('Garmin key', () => {
  it('prefers the variable, then the named file, then the default file', async () => {
    const path = await saveKey('from-default-file', directory);
    expect(path).toBe(keyFilePath(directory));
    expect(findKey({}, directory)).toEqual({ key: 'from-default-file', source: path });

    const named = join(directory, 'named');
    writeFileSync(named, '  from-named-file\n');
    expect(findKey({ GARMIN_PERSONAL_API_KEY_FILE: named }, directory)).toEqual({
      key: 'from-named-file',
      source: named,
    });

    expect(
      findKey(
        { GARMIN_PERSONAL_API_KEY: ' from-variable ', GARMIN_PERSONAL_API_KEY_FILE: named },
        directory,
      ),
    ).toEqual({ key: 'from-variable', source: 'GARMIN_PERSONAL_API_KEY' });
  });

  it('finds nothing when no key is set', () => {
    expect(findKey({}, directory)).toBeUndefined();
    expect(findKey({ GARMIN_PERSONAL_API_KEY: ' ' }, directory)).toBeUndefined();
  });

  it('replaces a saved key', async () => {
    await saveKey('first', directory);
    const path = await saveKey('second', directory);
    expect(readFileSync(path, 'utf8')).toBe('second\n');
  });

  posixOnly('saves the key in a private file', async () => {
    const path = await saveKey('key', directory);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, '.config', 'garmin')).mode & 0o777).toBe(0o700);
  });

  it('accepts a key Garmin exchanges for a token', async () => {
    const payload = btoa(JSON.stringify({ exp: 4_000_000_000 }));
    const fetchFn = vi.fn(() => Promise.resolve(new Response(`a.${payload}.c`)));
    expect(await checkKey('good-key', fetchFn)).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('reports a key Garmin rejects', async () => {
    const fetchFn = () => Promise.resolve(new Response('no', { status: 401 }));
    expect(await checkKey('expired-key', fetchFn)).toMatch(/rejected/);
  });

  it('rejects text that cannot be a key without calling Garmin', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('no')));
    expect(await checkKey('two words', fetchFn)).toMatch(/doesn't look like/);
    expect(await checkKey('', fetchFn)).toMatch(/doesn't look like/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('the key page', () => {
  interface Page {
    url: string;
    result: Promise<boolean>;
    saved: string[];
  }

  async function openPage(check: (key: string) => string | undefined, timeoutMs = 5000) {
    const saved: string[] = [];
    let result!: Promise<boolean>;
    const url = await new Promise<string>((resolve, reject) => {
      result = collectKey({
        check: (key) => Promise.resolve(check(key)),
        save: (key) => {
          saved.push(key);
          return Promise.resolve();
        },
        onReady: resolve,
        timeoutMs,
      });
      result.catch(reject);
    });
    return { url, result, saved } satisfies Page;
  }

  const submit = (url: string, key: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key }),
    });

  it('listens only on 127.0.0.1, on a secret path', async () => {
    const page = await openPage(() => undefined);
    const { protocol, hostname, pathname, origin } = new URL(page.url);
    expect(protocol).toBe('http:');
    expect(hostname).toBe('127.0.0.1');
    expect(pathname.length).toBeGreaterThan(30);

    expect((await fetch(`${origin}/`)).status).toBe(404);
    const response = await fetch(page.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('type="password"');

    await submit(page.url, 'key');
    await page.result;
  });

  it('saves a good key, then shuts down', async () => {
    const page = await openPage(() => undefined);
    const response = await submit(page.url, ' good-key ');
    expect(await response.text()).toContain('Key saved');
    expect(await page.result).toBe(true);
    expect(page.saved).toEqual(['good-key']);
    await expect(fetch(page.url)).rejects.toThrow();
  });

  it('shows the problem and lets the user try again', async () => {
    const page = await openPage((key) => (key === 'good' ? undefined : 'Garmin <rejected> it.'));
    const response = await submit(page.url, 'bad');
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('Garmin &lt;rejected&gt; it.');
    expect(html).not.toContain('bad');
    expect(page.saved).toEqual([]);

    await submit(page.url, 'good');
    expect(await page.result).toBe(true);
    expect(page.saved).toEqual(['good']);
  });

  it('refuses a request for another host name', async () => {
    const page = await openPage(() => undefined);
    const { request } = await import('node:http');
    const url = new URL(page.url);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          headers: { Host: 'evil.example' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      )
        .on('error', reject)
        .end();
    });
    expect(status).toBe(404);
    await submit(page.url, 'key');
    await page.result;
  });

  it('refuses an oversized form', async () => {
    const page = await openPage(() => undefined);
    const response = await submit(page.url, 'x'.repeat(10_000));
    expect(response.status).toBe(413);
    expect(page.saved).toEqual([]);
    await submit(page.url, 'key');
    await page.result;
  });

  it('gives up when the time runs out', async () => {
    const page = await openPage(() => undefined, 20);
    expect(await page.result).toBe(false);
    expect(page.saved).toEqual([]);
  });
});
