// /authorize: the owner signs in with OWNER_PASSPHRASE and approves the client.
// GET shows the page; POST checks the passphrase (rate limited) and completes the OAuth
// authorization. The library's consent helpers keep the request server-side and bind the
// form to this browser (CSRF), so the form carries only a one-time handle.

import {
  AuthorizationError,
  CimdFetchError,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { LoginLockout } from './lockout';
import { loginPage, messagePage, securityHeaders } from './page';
import { isPassphraseConfigured, passphraseFingerprint, passphraseMatches } from './passphrase';

export const OWNER_USER_ID = 'owner';

/** What a grant carries; checked on every MCP request and refresh. */
export interface GrantProps {
  passphraseFingerprint: string;
}

type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

function page(html: string, status = 200, headers?: Headers): Response {
  return new Response(html, { status, headers: securityHeaders(headers) });
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function minutes(seconds: number): string {
  const value = Math.ceil(seconds / 60);
  return `${value} minute${value === 1 ? '' : 's'}`;
}

export async function handleAuthorize(request: Request, env: AuthEnv): Promise<Response> {
  if (!isPassphraseConfigured(env.OWNER_PASSPHRASE)) {
    return page(
      messagePage(
        'Sign-in is not set up',
        'Set the OWNER_PASSPHRASE secret (at least 16 characters, e.g. from `openssl rand -base64 32`) and try again.',
      ),
      503,
    );
  }
  try {
    if (request.method === 'GET') return await showLogin(request, env);
    if (request.method === 'POST') return await submitLogin(request, env);
    return new Response('Method not allowed\n', { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    if (error instanceof AuthorizationError) {
      return page(messagePage('Sign-in failed', error.description), 400);
    }
    if (error instanceof CimdFetchError) {
      return page(messagePage('Sign-in failed', 'This app could not be verified.'), 400);
    }
    throw error;
  }
}

async function showLogin(
  request: Request,
  env: AuthEnv,
  error?: string,
  status = 200,
): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  return page(loginPage({ details, handle: consent.handle, error }), status, consent.headers);
}

async function submitLogin(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = formText(form, 'handle');

  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    denied.headers.set('Location', denied.redirectTo);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const ip = clientIp(request);
  const lockout = new LoginLockout(env.GARMIN_KV);
  const locked = await lockout.lockedFor(ip);
  if (locked > 0) {
    return page(
      messagePage(
        'Too many attempts',
        `Sign-in is paused after too many wrong passphrases. Try again in ${minutes(locked)}.`,
      ),
      429,
    );
  }

  const passphrase = formText(form, 'passphrase');
  if (!(await passphraseMatches(passphrase, env.OWNER_PASSPHRASE))) {
    await lockout.recordFailure(ip);
    // The form posts back to the same /authorize URL, so the request can be parsed again
    // and shown with a fresh handle; the unused one expires on its own.
    return showLogin(request, env, 'Wrong passphrase.', 401);
  }

  await lockout.recordSuccess(ip);
  const approved = await oauth.approveConsent(request, handle);
  const props: GrantProps = {
    passphraseFingerprint: await passphraseFingerprint(env.OWNER_PASSPHRASE),
  };
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: OWNER_USER_ID,
    metadata: { label: 'owner' },
    scope: approved.request.scope,
    props,
  });
  approved.headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}
