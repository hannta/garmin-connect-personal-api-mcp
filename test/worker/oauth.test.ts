// End-to-end OAuth flow in workerd with local KV: discovery, client registration, the
// passphrase sign-in page, token exchange, MCP access, lockout and passphrase rotation.

import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../../src/index';
import { LOCKOUT } from '../../src/auth/lockout';

const ORIGIN = 'http://localhost';
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const PASSPHRASE = 'correct horse battery staple test';

let ipCounter = 0;
/** A fresh client IP per test, so lockout counters don't leak between tests. */
function newIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

async function call(
  path: string,
  init: RequestInit = {},
  envOverrides: Partial<Env> = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const request = new Request(`${ORIGIN}${path}`, init);
  const response = await worker.fetch(
    request as Parameters<typeof worker.fetch>[0],
    { ...env, ...envOverrides },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

async function registerClient(name = 'Claude') {
  const response = await call('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  expect(response.status).toBe(201);
  const body: { client_id: string } = await response.json();
  return body.client_id;
}

/** Cookies from Set-Cookie headers, as a Cookie request header value. */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

function handleFrom(html: string): string {
  const match = /name="handle" value="([^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error('no handle on the page');
  return match[1];
}

interface LoginStart {
  query: string;
  verifier: string;
  page: Response;
  html: string;
  cookie: string;
  handle: string;
}

async function startLogin(clientId: string): Promise<LoginStart> {
  const { verifier, challenge } = await pkce();
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-123',
    resource: `${ORIGIN}/mcp`,
  }).toString();
  const page = await call(`/authorize?${query}`);
  const html = await page.text();
  return { query, verifier, page, html, cookie: cookiesFrom(page), handle: handleFrom(html) };
}

async function submit(
  login: Pick<LoginStart, 'query' | 'cookie' | 'handle'>,
  fields: { passphrase?: string; decision?: string },
  ip: string,
  envOverrides: Partial<Env> = {},
) {
  const body = new URLSearchParams({
    handle: login.handle,
    passphrase: fields.passphrase ?? '',
    decision: fields.decision ?? 'approve',
  });
  return call(
    `/authorize?${login.query}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: login.cookie,
        'CF-Connecting-IP': ip,
      },
      body,
      redirect: 'manual',
    },
    envOverrides,
  );
}

async function token(params: Record<string, string>, envOverrides: Partial<Env> = {}) {
  return call(
    '/oauth/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    },
    envOverrides,
  );
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function signIn(): Promise<{ clientId: string; tokens: Tokens }> {
  const clientId = await registerClient();
  const login = await startLogin(clientId);
  const approved = await submit(login, { passphrase: PASSPHRASE }, newIp());
  expect(approved.status).toBe(302);
  const location = new URL(approved.headers.get('Location') ?? '');
  const response = await token({
    grant_type: 'authorization_code',
    code: location.searchParams.get('code') ?? '',
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: login.verifier,
    resource: `${ORIGIN}/mcp`,
  });
  expect(response.status).toBe(200);
  return { clientId, tokens: await response.json() };
}

function listTools(accessToken?: string, envOverrides: Partial<Env> = {}) {
  return call(
    '/mcp',
    {
      method: 'POST',
      headers: {
        host: 'localhost',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        ...(accessToken && { authorization: `Bearer ${accessToken}` }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    },
    envOverrides,
  );
}

describe('test environment', () => {
  it('uses test secrets, never .dev.vars', () => {
    expect(env.GARMIN_API_KEY).toBe('test-api-key-not-real');
    expect(env.OWNER_PASSPHRASE).toBe(PASSPHRASE);
  });
});

describe('discovery', () => {
  it('answers unauthenticated MCP requests with a 401 challenge', async () => {
    const response = await listTools();
    expect(response.status).toBe(401);
    const challenge = response.headers.get('WWW-Authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer /);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    expect(metadataUrl).toBeTruthy();

    const metadata = await call(new URL(metadataUrl ?? '').pathname);
    const resource: { resource: string; authorization_servers: string[] } = await metadata.json();
    expect(resource.resource).toBe(`${ORIGIN}/mcp`);
    expect(resource.authorization_servers).toEqual([ORIGIN]);
  });

  it('publishes authorization server metadata', async () => {
    const response = await call('/.well-known/oauth-authorization-server');
    const metadata: Record<string, unknown> = await response.json();
    expect(metadata).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
    });
  });
});

describe('sign-in page', () => {
  it('shows the client and redirect host, escaped, with strict headers', async () => {
    const clientId = await registerClient('<script>alert(1)</script>');
    const { page, html } = await startLogin(clientId);

    expect(page.status).toBe(200);
    expect(html).toContain('&#60;script&#62;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('claude.ai');
    expect(page.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(page.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    expect(page.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('rejects a wrong passphrase with a generic message and a fresh form', async () => {
    const login = await startLogin(await registerClient());
    const response = await submit(login, { passphrase: 'wrong passphrase value' }, newIp());
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(html).toContain('Wrong passphrase.');
    expect(html).not.toContain('wrong passphrase value');
    expect(handleFrom(html)).not.toBe(login.handle);
  });

  it('refuses a form without the browser cookie (CSRF)', async () => {
    const login = await startLogin(await registerClient());
    const response = await submit({ ...login, cookie: '' }, { passphrase: PASSPHRASE }, newIp());
    expect(response.status).toBe(400);
    expect(response.headers.get('Location')).toBeNull();
  });

  it('redirects back with access_denied when the owner denies', async () => {
    const login = await startLogin(await registerClient());
    const response = await submit(login, { decision: 'deny' }, newIp());
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('state-123');
  });

  it(`locks sign-in for an IP after ${LOCKOUT.perIpFailures} wrong passphrases`, async () => {
    const ip = newIp();
    const clientId = await registerClient();
    for (let i = 0; i < LOCKOUT.perIpFailures; i++) {
      const login = await startLogin(clientId);
      expect((await submit(login, { passphrase: `wrong ${i}` }, ip)).status).toBe(401);
    }
    const login = await startLogin(clientId);
    const locked = await submit(login, { passphrase: PASSPHRASE }, ip);
    expect(locked.status).toBe(429);
    expect(await locked.text()).toMatch(/Try again in \d+ minutes?/);

    // Another IP can still sign in.
    const other = await startLogin(clientId);
    expect((await submit(other, { passphrase: PASSPHRASE }, newIp())).status).toBe(302);
  });

  it('is unavailable until OWNER_PASSPHRASE is set', async () => {
    const clientId = await registerClient();
    const response = await call(`/authorize?client_id=${clientId}`, {}, { OWNER_PASSPHRASE: '' });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('OWNER_PASSPHRASE');
  });
});

describe('several hostnames', () => {
  it('signs in on each hostname even when workerd reuses one env object', async () => {
    const shared = { ...env };
    const ctx = createExecutionContext();
    const fetchWith = (url: string, init?: RequestInit) =>
      worker.fetch(new Request(url, init) as Parameters<typeof worker.fetch>[0], shared, ctx);

    // A request on another hostname first (like a preview URL) …
    expect((await fetchWith('https://preview.example.workers.dev/')).status).toBe(200);
    // … must not break the authorization page on this one.
    const login = await startLogin(await registerClient());
    const response = await fetchWith(`${ORIGIN}/authorize?${login.query}`);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
  });
});

describe('tokens and MCP access', () => {
  it('completes the flow and serves MCP with the access token', async () => {
    const { tokens } = await signIn();
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.refresh_token).toBeTruthy();

    const response = await listTools(tokens.access_token);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('garmin_get_day');
  });

  it('refreshes tokens', async () => {
    const { clientId, tokens } = await signIn();
    const response = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(response.status).toBe(200);
    const refreshed: Tokens = await response.json();
    expect((await listTools(refreshed.access_token)).status).toBe(200);
  });

  it('rejects a made-up token', async () => {
    expect((await listTools('owner:fake:token')).status).toBe(401);
  });

  it('signs everyone out when the passphrase is rotated', async () => {
    const { clientId, tokens } = await signIn();
    const rotated = { OWNER_PASSPHRASE: 'a brand new passphrase value' };

    expect((await listTools(tokens.access_token, rotated)).status).toBe(401);

    const refresh = await token(
      { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId },
      rotated,
    );
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: 'invalid_grant' });

    // The grant is revoked, not just rejected: restoring the old passphrase doesn't revive it.
    const again = await token({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(again.status).toBe(400);
  });
});
