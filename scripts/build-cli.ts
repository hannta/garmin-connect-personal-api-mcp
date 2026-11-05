// Bundles the local server into dist/cli.mjs, the one file the npm package runs, with the
// licenses of the bundled packages next to it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: ['src/local/cli.ts'],
  outfile: 'dist/cli.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  metafile: true,
  // Some bundled CommonJS code calls require(), which an ES module doesn't have.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire } from 'node:module';",
      'const require = createRequire(import.meta.url);',
    ].join('\n'),
  },
});

const packages = new Set<string>();
for (const input of Object.keys(metafile.inputs)) {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (match?.[1]) packages.add(match[1]);
}

const notices = [...packages].sort().map((directory) => {
  const path = join(root, directory);
  const license = readdirSync(path).find((name) => /^licen[cs]e/i.test(name));
  if (!license) throw new Error(`No license file in ${directory}`);
  const name = directory.slice(directory.lastIndexOf('node_modules/') + 'node_modules/'.length);
  return `${name}\n\n${readFileSync(join(path, license), 'utf8').trim()}\n`;
});
writeFileSync(join(dist, 'THIRD-PARTY-LICENSES.txt'), notices.join('\n---\n\n'));
