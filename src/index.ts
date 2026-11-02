// Worker entry: OAuth (owner passphrase sign-in) in front of the MCP endpoint at /mcp.
// See oauth.ts for the routes and auth/ for the sign-in page.

import { providerFor } from './oauth';

export default {
  fetch(request, env, ctx): Promise<Response> {
    // A shallow copy per request: the OAuth library caches its helpers on `env`, which
    // workerd reuses across requests, so the first hostname's provider would otherwise
    // serve every hostname (e.g. a preview URL breaking sign-in on the main one).
    return providerFor(request).fetch(request, { ...env }, ctx);
  },
} satisfies ExportedHandler<Env>;
