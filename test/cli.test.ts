// Runs the bundled CLI the way an MCP client does. CI also runs this file on the oldest
// supported Node.js version.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { version } from '../package.json';

const root = join(import.meta.dirname, '..');
const cli = join(root, 'dist', 'cli.mjs');

let home: string;

function env(): NodeJS.ProcessEnv {
  return { ...process.env, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: '' };
}

function run(args: string[], input = '') {
  const result = spawnSync(process.execPath, [cli, ...args], {
    env: env(),
    input,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts'], { cwd: root });
  home = mkdtempSync(join(tmpdir(), 'garmin-mcp-cli-'));
}, 60_000);

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('the bundled CLI', () => {
  it('prints its version and help', () => {
    expect(run(['--version']).stdout.trim()).toBe(version);
    expect(run(['--help']).stdout).toContain('auth --terminal');
  });

  it('refuses unknown commands and options', () => {
    expect(run(['nonsense']).status).toBe(2);
    expect(run(['--nonsense']).status).toBe(2);
    expect(run(['doctor', '--terminal']).status).toBe(2);
    expect(run(['auth', '--check', '--terminal']).status).toBe(2);
  });

  it('serves all tools over stdio, and a missing key is a readable tool error', async () => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cli],
        env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home },
      }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(27);
      const result = await client.callTool({ name: 'garmin_get_profile', arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('auth');
    } finally {
      await client.close();
    }
  });

  it('keeps stdout to the protocol', async () => {
    const server = spawn(process.execPath, [cli], { env: env() });
    const lines = await new Promise<string[]>((resolve) => {
      let output = '';
      server.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (output.includes('\n')) {
          server.kill();
          resolve(output.trim().split('\n'));
        }
      });
      server.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '1.0.0' },
          },
        })}\n`,
      );
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ jsonrpc: '2.0', id: 1 });
  });

  it('says what is missing without a key', () => {
    const check = run(['auth', '--check']);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain('No Garmin key');

    const doctor = run(['doctor']);
    expect(doctor.status).toBe(1);
    expect(doctor.stdout).toContain('FAIL No Garmin key');
    expect(doctor.stdout).toContain('ok   Cache directory');
  });

  it('refuses an empty or malformed key from stdin', () => {
    expect(run(['auth', '--terminal']).stderr).toContain('No key entered');
    const result = run(['auth', '--terminal'], 'not a key\n');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("doesn't look like");
  });
});
