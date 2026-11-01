import { defineConfig } from 'vitest/config';

// Phase 1 code (Garmin client, units, dates) is runtime-agnostic and is tested in Node.
// Worker-level integration tests come in Phase 2 with @cloudflare/vitest-plugin.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
