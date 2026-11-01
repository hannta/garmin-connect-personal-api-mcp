// Tool definitions are plain objects so tests can call `run` directly; server.ts
// registers them with the MCP server.

import { z } from 'zod';
import type { ToolContext } from './context';

export interface ToolDefinition<Schema extends z.ZodObject = z.ZodObject, Output = unknown> {
  name: string;
  title: string;
  description: string;
  inputSchema: Schema;
  run(input: z.output<Schema>, context: ToolContext): Promise<Output>;
}

export function defineTool<Schema extends z.ZodObject, Output>(
  tool: ToolDefinition<Schema, Output>,
): ToolDefinition<Schema, Output> {
  return tool;
}

/** A YYYY-MM-DD local calendar date. */
export function dateInput(description: string) {
  return z.iso.date().optional().describe(description);
}
