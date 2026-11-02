// OAuth 2.1 in front of the MCP endpoint. One Worker is both the authorization server
// (owner sign-in, tokens) and the resource (/mcp), using the library's combined
// OAuthProvider. The resource URL is the request's own origin + /mcp, so each deployment
// works on its workers.dev or custom hostname without configuration.

import { OAuthError, OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { handleAuthorize, type GrantProps } from './auth/authorize';
import { passphraseFingerprint } from './auth/passphrase';
import { createServer } from './server';

export const MCP_ROUTE = '/mcp';
export const AUTHORIZE_ROUTE = '/authorize';

const DAY_SECONDS = 24 * 60 * 60;

export const TOKEN_LIFETIMES = {
  accessTokenTTL: 60 * 60,
  /** Sign in again only after 30 days without use: each refresh renews the grant. */
  refreshTokenTTL: 30 * DAY_SECONDS,
  refreshTokenIdleTTL: 30 * DAY_SECONDS,
} as const;

/** Grants issued under an earlier OWNER_PASSPHRASE stop working once it's rotated. */
export async function isGrantCurrent(props: unknown, env: Env): Promise<boolean> {
  const fingerprint = (props as Partial<GrantProps> | null)?.passphraseFingerprint;
  return fingerprint === (await passphraseFingerprint(env.OWNER_PASSPHRASE));
}

const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { props } = ctx as ExecutionContext & { props: unknown };
    if (!(await isGrantCurrent(props, env))) {
      return new Response('The owner passphrase changed. Sign in again.\n', {
        status: 401,
        headers: {
          'WWW-Authenticate':
            'Bearer error="invalid_token", error_description="The owner passphrase changed"',
        },
      });
    }
    const handler = createMcpHandler(() => createServer(env), { route: MCP_ROUTE });
    return handler(request, env, ctx);
  },
};

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === AUTHORIZE_ROUTE) {
      return handleAuthorize(request, env as Parameters<typeof handleAuthorize>[1]);
    }
    if (pathname === '/') {
      return new Response('garmin-connect-personal-api-mcp\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response('Not found\n', { status: 404 });
  },
};

export function createProvider(origin: string): OAuthProvider<Env> {
  return new OAuthProvider<Env>({
    apiRoute: MCP_ROUTE,
    apiHandler: mcpApiHandler,
    defaultHandler,
    authorizeEndpoint: AUTHORIZE_ROUTE,
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: `${origin}${MCP_ROUTE}`,
      authorization_servers: [origin],
      resource_name: 'Garmin Connect (personal)',
    },
    ...TOKEN_LIFETIMES,
    async tokenExchangeCallback({ props, env }) {
      if (!(await isGrantCurrent(props, env))) {
        // invalid_grant also revokes the grant and its tokens.
        throw new OAuthError('invalid_grant', {
          description: 'The owner passphrase changed. Sign in again.',
        });
      }
    },
  });
}

// One provider per hostname. Cloudflare routes only this Worker's own hostnames here,
// so the map stays tiny; the cap is a safeguard.
const providers = new Map<string, OAuthProvider<Env>>();

export function providerFor(request: Request): OAuthProvider<Env> {
  const { origin } = new URL(request.url);
  let provider = providers.get(origin);
  if (!provider) {
    if (providers.size >= 8) providers.clear();
    provider = createProvider(origin);
    providers.set(origin, provider);
  }
  return provider;
}
