// Turns tool output into MCP results: compact JSON without null fields, and errors as
// readable tool errors (isError) instead of protocol failures, so Claude can explain them.

import type { CallToolResult } from '@modelcontextprotocol/server';
import { GarminError } from '../garmin/errors';
import { DateInputError } from '../lib/dates';

/**
 * Drops null / undefined values, empty or blank strings and objects left empty, recursively.
 * Arrays are kept. Strings are trimmed (Garmin activity names often end with a space).
 */
export function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value)
    .map(([key, item]) => [key, compact(item)] as const)
    .filter(([, item]) => item !== null && item !== undefined && !isEmptyObject(item));
  return Object.fromEntries(entries);
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(compact(data)) }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** A message that is safe to show: never the API key, tokens or response bodies. */
export function errorMessage(error: unknown): string {
  if (error instanceof GarminError) {
    switch (error.code) {
      case 'missing_key':
        return `${error.message} Create a Personal API key in Garmin Connect and set it as the GARMIN_API_KEY secret.`;
      case 'invalid_key':
        return `${error.message} Personal API keys expire; create a new one in Garmin Connect and update the GARMIN_API_KEY secret.`;
      case 'rate_limited':
        return `${error.message} Wait a moment before trying again.`;
      default:
        return error.message;
    }
  }
  if (error instanceof DateInputError || error instanceof RangeError) return error.message;
  return 'Unexpected error while reading Garmin data.';
}

export async function runTool(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await run());
  } catch (error) {
    if (!(error instanceof GarminError || error instanceof DateInputError)) {
      console.error('Tool failed:', error instanceof Error ? error.message : error);
    }
    return errorResult(errorMessage(error));
  }
}
