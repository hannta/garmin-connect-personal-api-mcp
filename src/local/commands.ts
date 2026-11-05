// The CLI's commands other than serving: `auth` in its forms, and `doctor`. They never
// print the key.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { collectKey } from './auth-page';
import { cacheDirectory, FileStore } from './file-store';
import { checkKey, findKey, KEY_FILE_VARIABLE, KEY_VARIABLE, saveKey } from './key';

const AUTH_PAGE_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_NODE_VERSION = 22;

function openBrowser(url: string): void {
  const [command, ...args] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['rundll32', 'url.dll,FileProtocolHandler', url]
        : ['xdg-open', url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', () => undefined); // no browser here: the printed link still works
  child.unref();
}

/** `auth`: the temporary page. */
export async function authWithPage(): Promise<number> {
  const saved = await collectKey({
    check: (key) => checkKey(key),
    save: async (key) => {
      await saveKey(key);
    },
    onReady: (url) => {
      console.log(`Enter your Garmin key on this page:\n\n  ${url}\n`);
      console.log('Waiting for the key. The page closes itself after 10 minutes.');
      openBrowser(url);
    },
    timeoutMs: AUTH_PAGE_TIMEOUT_MS,
  });
  if (!saved) {
    console.error('Timed out. Run auth again, or use auth --terminal without a browser.');
    return 1;
  }
  console.log('Key saved. It is used from the next tool call on.');
  return 0;
}

async function readStdin(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin as AsyncIterable<Buffer>) text += chunk.toString('utf8');
  return text;
}

function promptHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const reader = createInterface({ input: process.stdin, output: silent, terminal: true });
  return new Promise((resolve) => {
    reader.once('line', (line) => {
      process.stdout.write('\n');
      resolve(line);
      reader.close();
    });
    reader.once('close', () => {
      resolve('');
    });
  });
}

/** `auth --terminal`: a hidden prompt, or the key piped in on stdin. */
export async function authInTerminal(): Promise<number> {
  const input = process.stdin.isTTY
    ? await promptHidden('Garmin Personal API key: ')
    : await readStdin();
  const key = input.trim();
  if (!key) {
    console.error('No key entered.');
    return 1;
  }
  const problem = await checkKey(key);
  if (problem) {
    console.error(problem);
    return 1;
  }
  console.log(`Key saved to ${await saveKey(key)}.`);
  return 0;
}

/** `auth --check`: whether the key in use works. */
export async function authCheck(): Promise<number> {
  const found = findKey();
  if (!found) {
    console.error('No Garmin key found. Run auth to save one.');
    return 1;
  }
  const problem = await checkKey(found.key);
  if (problem) {
    console.error(`The key from ${found.source} doesn't work. ${problem}`);
    return 1;
  }
  console.log(`The key from ${found.source} works.`);
  return 0;
}

/** `doctor`: checks everything the server needs, and says how to fix what's wrong. */
export async function doctor(): Promise<number> {
  const results: { ok: boolean; text: string }[] = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  results.push({
    ok: nodeMajor >= MIN_NODE_VERSION,
    text: `Node.js ${process.versions.node} (needs ${MIN_NODE_VERSION} or newer)`,
  });

  const found = findKey();
  if (found) {
    const problem = await checkKey(found.key);
    results.push({
      ok: !problem,
      text: problem ? `Key from ${found.source}: ${problem}` : `Key from ${found.source} works`,
    });
  } else {
    results.push({
      ok: false,
      text: `No Garmin key: run auth, or set ${KEY_VARIABLE} or ${KEY_FILE_VARIABLE}`,
    });
  }

  const directory = cacheDirectory();
  const store = new FileStore(directory);
  const probe = 'doctor:probe';
  await store.put(probe, 'ok', { expirationTtl: 60 });
  results.push({
    ok: (await store.get(probe)) === 'ok',
    text: `Cache directory ${directory}`,
  });

  for (const { ok, text } of results) console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  return results.every((result) => result.ok) ? 0 : 1;
}
