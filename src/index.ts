// Worker entry. Phase 2 adds the MCP handler at /mcp; Phase 3 wraps it in OAuth.
export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname === '/') {
      return new Response('garmin-connect-personal-api-mcp\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response('Not found\n', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
