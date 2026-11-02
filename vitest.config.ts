import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Two projects: runtime-agnostic code (Garmin client, tools, MCP server) runs in Node;
// the Worker with OAuth runs in workerd with local KV (test/worker/).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/worker/**'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            // Test values override anything in .dev.vars: tests never use real secrets.
            miniflare: {
              bindings: {
                GARMIN_API_KEY: 'test-api-key-not-real',
                OWNER_PASSPHRASE: 'correct horse battery staple test',
              },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.ts'],
        },
      },
    ],
  },
});
