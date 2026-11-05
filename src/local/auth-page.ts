// A temporary page on 127.0.0.1 where the user pastes their Garmin key, so it never passes
// through an AI agent, a chat or the shell history. It answers only on a secret path, and
// it shuts down once a key is saved or the time runs out.

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 4096;

export interface KeyPageOptions {
  /** Returns what's wrong with the key, or undefined if it works. */
  check(key: string): Promise<string | undefined>;
  save(key: string): Promise<void>;
  onReady(url: string): void;
  timeoutMs: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Garmin</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
  body { max-width: 28rem; margin: 15vh auto 0; padding: 0 1rem; }
  h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
  label { display: block; font-weight: 600; margin: 1.25rem 0 0.25rem; }
  input, button { box-sizing: border-box; width: 100%; padding: 0.6rem; font: inherit; }
  button { margin-top: 0.75rem; cursor: pointer; }
  .error { color: #c5221f; }
  .note { font-size: 0.875rem; opacity: 0.75; }
  @media (prefers-color-scheme: dark) { .error { color: #f28b82; } }
</style>
</head>
<body>
${content}
</body>
</html>
`;
}

function form(error?: string): string {
  return page(`<h1>Connect your Garmin account</h1>
<p>Create a key in Garmin Connect on the web, on the <strong>Personal API Key</strong> page,
and paste it here. Garmin shows it only once.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post">
  <label for="key">Personal API key</label>
  <input id="key" name="key" type="password" required autofocus autocomplete="off" spellcheck="false">
  <button type="submit">Save key</button>
</form>
<p class="note">The key is checked with Garmin and saved in a private file on this computer.
It isn't shown to your AI assistant.</p>`);
}

const DONE = page(`<h1>Key saved</h1>
<p>You can close this page and go back to your AI assistant.</p>`);

function send(response: ServerResponse, status: number, body: string, end?: () => void): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body, end);
}

async function readBody(request: IncomingMessage): Promise<string | undefined> {
  let body = '';
  for await (const chunk of request as AsyncIterable<Buffer>) {
    body += chunk.toString('utf8');
    if (body.length > MAX_BODY_BYTES) return undefined;
  }
  return body;
}

/** Resolves true once a key is saved, or false if the time runs out. */
export function collectKey(options: KeyPageOptions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const path = `/${randomBytes(24).toString('base64url')}`;
    let host = '';

    const finish = (saved: boolean): void => {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
      resolve(saved);
    };

    const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
      // The Host check stops other sites from reaching this page by DNS rebinding.
      if (request.headers.host !== host || request.url !== path) {
        send(response, 404, page('<h1>Not found</h1>'));
        return;
      }
      if (request.method === 'GET') {
        send(response, 200, form());
        return;
      }
      if (request.method !== 'POST') {
        send(response, 405, form());
        return;
      }
      const body = await readBody(request);
      if (body === undefined) {
        send(response, 413, form('That is too long to be a key.'));
        return;
      }
      const key = new URLSearchParams(body).get('key')?.trim() ?? '';
      const problem = await options.check(key);
      if (problem) {
        send(response, 400, form(problem));
        return;
      }
      await options.save(key);
      send(response, 200, DONE, () => {
        finish(true);
      });
    };

    const server = createServer((request, response) => {
      handle(request, response).catch(() => {
        send(response, 500, form('Could not save the key. Check the terminal and try again.'));
      });
    });
    const timer = setTimeout(() => {
      finish(false);
    }, options.timeoutMs);

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not start the local page.'));
        return;
      }
      host = `127.0.0.1:${address.port}`;
      options.onReady(`http://${host}${path}`);
    });
  });
}
