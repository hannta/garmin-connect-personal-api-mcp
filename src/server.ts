// MCP server factory: a fresh McpServer per request (stateless) with all tools. OAuth
// in front of it is in oauth.ts.

import { McpServer } from '@modelcontextprotocol/server';
import { GarminClient } from './garmin/client';
import type { KeyValueStore } from './garmin/store';
import { TokenProvider } from './garmin/token';
import { createToolContext, type ToolContext } from './tools/context';
import type { ToolDefinition } from './tools/define';
import { getActivityTool } from './tools/get-activity';
import { getActivityStreamsTool } from './tools/get-activity-streams';
import { getDayTool } from './tools/get-day';
import { getDaysTool } from './tools/get-days';
import { getHrvTool } from './tools/get-hrv';
import { getProfileTool } from './tools/get-profile';
import { getSleepTool } from './tools/get-sleep';
import { getWeightTool } from './tools/get-weight';
import { runTool } from './tools/result';
import { searchActivitiesTool } from './tools/search-activities';
import {
  getDailySummariesTool,
  getHrvSummariesTool,
  getSleepSummariesTool,
} from './tools/summaries';

export const SERVER_NAME = 'garmin-connect-personal-api-mcp';
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = [
  "Read-only access to the user's Garmin Connect data (activities, sleep, HRV, daily",
  'recovery metrics, heart-rate zones). All values are metric; every field name includes',
  "its unit. Dates are YYYY-MM-DD in the user's time zone, and omitted dates mean today.",
  'Sleep and HRV are keyed by the wake-up date. Start with garmin_get_day for readiness',
  'questions, garmin_get_days for trends over a range, and garmin_search_activities to',
  'find activities. Range tools default to the last 7 days and make one Garmin request',
  'per source; if a range is too long, the error says the maximum: split it into several',
  'calls. Range results include plain average / min / max statistics in `summary`; any',
  'further analysis is yours.',
  'Not available from the Garmin Personal API: Training Readiness, Training Status,',
  'VO2max, personal records, gear and per-lap data. Say so instead of guessing, and',
  'label any readiness estimate you make from HRV, sleep and load as your own estimate.',
].join(' ');

export interface ServerOptions {
  /** Overrides for tests: Garmin fetch and clock. */
  fetch?: typeof fetch;
  now?: () => Date;
}

export function createServer(env: Env, options: ServerOptions = {}): McpServer {
  const store: KeyValueStore = env.GARMIN_KV;
  const context = createToolContext({
    client: () => {
      const tokens = new TokenProvider({
        apiKey: env.GARMIN_API_KEY,
        store,
        ...(options.fetch && { fetch: options.fetch }),
      });
      return new GarminClient({ tokens, ...(options.fetch && { fetch: options.fetch }) });
    },
    store,
    timeZoneOverride: env.TIMEZONE,
    ...(options.now && { now: options.now }),
  });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  register(server, context, getDayTool);
  register(server, context, searchActivitiesTool);
  register(server, context, getActivityTool);
  register(server, context, getSleepTool);
  register(server, context, getHrvTool);
  register(server, context, getProfileTool);
  register(server, context, getDaysTool);
  register(server, context, getDailySummariesTool);
  register(server, context, getSleepSummariesTool);
  register(server, context, getHrvSummariesTool);
  register(server, context, getWeightTool);
  register(server, context, getActivityStreamsTool);
  return server;
}

// Not generic: the SDK validates input against each tool's own schema before calling it.
function register(server: McpServer, context: ToolContext, tool: ToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => runTool(() => tool.run(input, context)),
  );
}
