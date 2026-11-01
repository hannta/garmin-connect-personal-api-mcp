// Worker entry: the MCP endpoint at /mcp (Streamable HTTP, stateless).
// Phase 3 wraps it in OAuth. Until then the endpoint has no authentication, so it only
// answers on localhost (`wrangler dev`); a deployed Worker refuses MCP requests.

import { createMcpHandler } from 'agents/mcp/server';
import { createServer } from './server';

const MCP_ROUTE = '/mcp';
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname, hostname } = new URL(request.url);
    if (pathname === MCP_ROUTE) {
      if (!LOCAL_HOSTNAMES.includes(hostname)) {
        return new Response('The MCP endpoint is disabled until OAuth is configured.\n', {
          status: 403,
        });
      }
      const handler = createMcpHandler(() => createServer(env), {
        route: MCP_ROUTE,
        allowedHostnames: LOCAL_HOSTNAMES,
      });
      return handler(request, env, ctx);
    }
    if (pathname === '/') {
      return new Response('garmin-connect-personal-api-mcp\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response('Not found\n', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
