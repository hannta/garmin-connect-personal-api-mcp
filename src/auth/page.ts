// The sign-in page shown on /authorize. Everything that came from the client (its name,
// domain and redirect host) is escaped: dynamic registration lets anyone choose them.

import type { ConsentDescription } from '@cloudflare/workers-oauth-provider';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Headers for every auth page: no caching, no framing, no scripts. */
export function securityHeaders(base: Headers = new Headers()): Headers {
  const headers = new Headers(base);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  );
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return headers;
}

const STYLE = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 28rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .box { border: 1px solid #8884; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; }
  .warn { border-color: #c80; }
  .error { border-color: #c33; }
  label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
  input[type=password] { width: 100%; box-sizing: border-box; padding: 0.6rem; font-size: 1rem; }
  .actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
  button { padding: 0.6rem 1rem; font-size: 1rem; }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export interface LoginPageOptions {
  details: ConsentDescription;
  handle: string;
  error?: string | undefined;
}

export function loginPage({ details, handle, error }: LoginPageOptions): string {
  const name = escapeHtml(details.clientName || 'An app');
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : 'This app registered itself; its name is not verified.';
  return layout(
    'Sign in — Garmin MCP',
    `<h1>Allow ${name} to read your Garmin data?</h1>
<p>${origin} Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.
It can read activities, sleep, HRV and daily health data, but can't change anything.</p>
${
  details.redirectIsLoopback
    ? '<p class="box warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>'
    : ''
}
${error ? `<p class="box error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" class="box">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <label for="passphrase">Owner passphrase</label>
  <input type="password" id="passphrase" name="passphrase" autocomplete="current-password" autofocus>
  <div class="actions">
    <button name="decision" value="approve">Allow</button>
    <button name="decision" value="deny">Deny</button>
  </div>
</form>`,
  );
}

export function messagePage(title: string, message: string): string {
  return layout(title, `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(message)}</p>`);
}
