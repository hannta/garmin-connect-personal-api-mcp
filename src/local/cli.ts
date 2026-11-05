// The local server's command line: with no command it serves MCP over stdio. In that mode
// stdout carries only the protocol, so anything else goes to stderr.

import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createServer, SERVER_VERSION } from '../server';
import { authCheck, authInTerminal, authWithPage, doctor } from './commands';
import { cacheDirectory, FileStore } from './file-store';
import { findKey } from './key';

const USAGE = `Garmin Connect Personal API MCP server

Usage: garmin-connect-personal-api-mcp [command]

  (no command)      Run the MCP server over stdio
  auth              Save your Garmin key using a temporary local page
  auth --terminal   Save your key from a hidden prompt, or from stdin
  auth --check      Check that the saved key works
  doctor            Check the setup
  --version         Print the version
  --help            Print this help
`;

async function serve(): Promise<number> {
  const store = new FileStore(cacheDirectory());
  void store.prune();
  const server = createServer({
    apiKey: () => findKey()?.key,
    store,
    timeZone: process.env.TIMEZONE,
  });
  await server.connect(new StdioServerTransport());
  return 0;
}

function run(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      check: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      terminal: { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  const [command, ...rest] = positionals;
  const authFlags = values.check || values.terminal;
  if (values.help) {
    console.log(USAGE);
    return Promise.resolve(0);
  }
  if (values.version) {
    console.log(SERVER_VERSION);
    return Promise.resolve(0);
  }
  if (rest.length > 0 || (values.check && values.terminal)) throw new TypeError('Bad arguments');
  if (command === 'auth') {
    if (values.check) return authCheck();
    return values.terminal ? authInTerminal() : authWithPage();
  }
  if (authFlags) throw new TypeError('Bad arguments');
  if (command === 'doctor') return doctor();
  if (command === undefined) return serve();
  throw new TypeError('Bad arguments');
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  if (error instanceof TypeError) {
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
