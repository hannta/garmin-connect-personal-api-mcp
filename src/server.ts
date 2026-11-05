// MCP server factory: a fresh McpServer per request (stateless) with all tools. OAuth
// in front of it is in oauth.ts.

import { McpServer } from '@modelcontextprotocol/server';
import { version } from '../package.json';
import { GarminClient } from './garmin/client';
import type { KeyValueStore } from './garmin/store';
import { TokenProvider } from './garmin/token';
import { createToolContext, type ToolContext } from './tools/context';
import type { ToolDefinition } from './tools/define';
import { getActivityTool } from './tools/get-activity';
import { getActivityLapsTool } from './tools/get-activity-laps';
import { getActivityStreamsTool } from './tools/get-activity-streams';
import { getFitnessAgeTool, getHeartRateZonesTool, getWeightGoalsTool } from './tools/fitness';
import { getDayTool } from './tools/get-day';
import { getDaysTool } from './tools/get-days';
import { getHeartRateTool } from './tools/get-heart-rate';
import { getHrvTool } from './tools/get-hrv';
import { getProfileTool } from './tools/get-profile';
import { getSleepTool } from './tools/get-sleep';
import { getSpo2Tool } from './tools/get-spo2';
import { getWeightTool } from './tools/get-weight';
import { getMenstrualCycleTool, getMenstrualDayTool } from './tools/menstrual';
import { getFoodLogTool, getHydrationTool } from './tools/nutrition';
import { runTool } from './tools/result';
import { searchActivitiesTool } from './tools/search-activities';
import {
  getDailySummariesTool,
  getHrvSummariesTool,
  getSleepSummariesTool,
} from './tools/summaries';
import { getBodyBatteryTool, getStepsTool, getStressTool } from './tools/wellness';
import { getWellnessActivitiesTool } from './tools/wellness-activities';
import { getActivityWorkoutsTool } from './tools/workouts';

export const SERVER_NAME = 'garmin-connect-personal-api-mcp';
export const SERVER_VERSION = version;

const ASSETS_URL =
  'https://raw.githubusercontent.com/hannta/garmin-connect-personal-api-mcp/main/assets';
const SERVER_ICONS = [
  { src: `${ASSETS_URL}/icon.png`, mimeType: 'image/png', sizes: ['512x512'] },
  { src: `${ASSETS_URL}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
];

const INSTRUCTIONS = [
  "Read-only access to the user's Garmin Connect data (activities, sleep, HRV, daily",
  'recovery metrics, Body Battery, stress, heart rate, weight, heart-rate zones). All',
  "values are metric; every field name includes its unit. Dates are YYYY-MM-DD in the user's time zone, and omitted dates mean today.",
  'Sleep and HRV are keyed by the wake-up date. Start with garmin_get_day for readiness',
  'questions, garmin_get_days for trends over a range, and garmin_search_activities to',
  'find activities. Range tools default to the last 7 days and make one Garmin request',
  'per source; if a range is too long, the error says the maximum: split it into several',
  'calls. Range results include plain average / min / max statistics in `summary`; any',
  'further analysis is yours. Use garmin_get_activity_laps for one row per lap or',
  'interval rep.',
  'Not available from the Garmin Personal API: Training Readiness, Training Status,',
  'VO2max history, a personal-records list and gear. Say so instead of guessing, and',
  'label any readiness estimate you make from HRV, sleep and load as your own estimate.',
].join(' ');

export interface ServerSettings {
  /** Read on every tool call, so a local server picks up a new key without a restart. */
  apiKey: () => string | undefined;
  store: KeyValueStore;
  /** IANA time zone override; empty or unset means "use the Garmin profile". */
  timeZone?: string | undefined;
  /** Overrides for tests: Garmin fetch and clock. */
  fetch?: typeof fetch;
  now?: () => Date;
}

export function createServer(settings: ServerSettings): McpServer {
  const { store, fetch } = settings;
  const context = (): ToolContext =>
    createToolContext({
      client: () => {
        const tokens = new TokenProvider({
          apiKey: settings.apiKey(),
          store,
          ...(fetch && { fetch }),
        });
        return new GarminClient({ tokens, ...(fetch && { fetch }) });
      },
      store,
      timeZoneOverride: settings.timeZone,
      ...(settings.now && { now: settings.now }),
    });

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION, icons: SERVER_ICONS },
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
  register(server, context, getBodyBatteryTool);
  register(server, context, getStressTool);
  register(server, context, getStepsTool);
  register(server, context, getHeartRateTool);
  register(server, context, getSpo2Tool);
  register(server, context, getFitnessAgeTool);
  register(server, context, getHeartRateZonesTool);
  register(server, context, getWeightGoalsTool);
  register(server, context, getHydrationTool);
  register(server, context, getWellnessActivitiesTool);
  register(server, context, getFoodLogTool);
  register(server, context, getMenstrualCycleTool);
  register(server, context, getMenstrualDayTool);
  register(server, context, getActivityWorkoutsTool);
  register(server, context, getActivityStreamsTool);
  register(server, context, getActivityLapsTool);
  return server;
}

// Not generic: the SDK validates input against each tool's own schema before calling it.
function register(server: McpServer, context: () => ToolContext, tool: ToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => runTool(() => tool.run(input, context())),
  );
}
