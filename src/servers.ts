// SPDX-License-Identifier: Apache-2.0
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { KITCHEN_SINK_TOOLS, TOOL_BY_NAME, invokeTool } from './catalog.js';
import { firstSentence } from './tokens.js';
import { rankDocs, roundScore } from './rank.js';
import type { ToolSpec } from './types.js';

function zodField(spec: ToolSpec['fields'][number]): z.ZodType {
  let schema: z.ZodType;
  if (spec.enumValues) {
    schema = z.enum(spec.enumValues);
  } else if (spec.type === 'number') {
    schema = z.number();
  } else if (spec.type === 'boolean') {
    schema = z.boolean();
  } else if (spec.type === 'string[]') {
    schema = z.array(z.string());
  } else {
    schema = z.string();
  }
  schema = schema.describe(spec.description);
  if (!spec.required) schema = schema.optional();
  return schema;
}

function inputSchema(spec: ToolSpec): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const fieldSpec of spec.fields) shape[fieldSpec.name] = zodField(fieldSpec);
  return z.object(shape);
}

function registerDomainTool(server: McpServer, spec: ToolSpec): void {
  server.registerTool(
    spec.name,
    {
      description: spec.description,
      inputSchema: inputSchema(spec),
    },
    async (args) => {
      const outcome = invokeTool(spec, args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(outcome.payload) }],
        isError: !outcome.ok,
      };
    },
  );
}

export function createKitchenSinkServer(options?: { allow?: ReadonlySet<string> }): McpServer {
  const server = new McpServer({ name: 'kitchen-sink', version: '0.1.0' });
  for (const spec of KITCHEN_SINK_TOOLS) {
    if (options?.allow && !options.allow.has(spec.name)) continue;
    registerDomainTool(server, spec);
  }
  return server;
}

export interface SkillEntry {
  name: string;
  summary: string;
}

export function skillEntries(names: readonly string[]): SkillEntry[] {
  const entries: SkillEntry[] = [];
  for (const name of names) {
    const spec = TOOL_BY_NAME.get(name);
    if (!spec) continue;
    entries.push({ name, summary: firstSentence(spec.description) });
  }
  return entries;
}

export function renderSkill(entries: readonly SkillEntry[]): string {
  const lines = [
    '# MCP Diet CLI skill',
    '',
    'Call the MCP tool `diet_exec` with `{"tool":"<name>","args_json":"<json object>"}`.',
    'Only the hot set is listed. Tools absent from this list are not available on this arm.',
    'A shell form of the same wrapper is `node diet-cli.mjs <tool> \'<json>\'`.',
    '',
    '| Tool | Summary |',
    '| --- | --- |',
    ...entries.map((entry) => `| ${entry.name} | ${entry.summary} |`),
    '',
  ];
  return lines.join('\n');
}

const SKILL_ROW = /^\| ([a-z][a-z0-9_]*) \| (.+) \|$/;

export function parseSkill(markdown: string): SkillEntry[] {
  const entries: SkillEntry[] = [];
  for (const line of markdown.split('\n')) {
    const match = SKILL_ROW.exec(line.trim());
    if (!match) continue;
    const name = match[1];
    const summary = match[2];
    if (!name || !summary) continue;
    entries.push({ name, summary: summary.trim() });
  }
  return entries;
}

export function createCliSkillServer(keptNames: readonly string[]): McpServer {
  const entries = skillEntries(keptNames);
  const allowed = new Set(entries.map((entry) => entry.name));
  const server = new McpServer(
    { name: 'kitchen-sink-cli-skill', version: '0.1.0' },
    { instructions: renderSkill(entries) },
  );
  server.registerTool(
    'diet_exec',
    {
      description:
        'Run one hot-set MCP tool by name. Full input schemas are not inlined. Read the server instructions for names and one-line summaries. args_json is a JSON object.',
      inputSchema: z.object({
        tool: z.string().describe('Tool name from the diet skill hot set.'),
        args_json: z.string().optional().describe('JSON object of arguments. Omit or pass {} when empty.'),
      }),
    },
    async ({ tool, args_json }) => {
      const spec = TOOL_BY_NAME.get(tool);
      if (!spec || !allowed.has(tool)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'tool-not-in-hot-set', tool }) }],
          isError: true,
        };
      }
      let parsed: unknown = {};
      if (args_json && args_json.trim()) {
        try {
          parsed = JSON.parse(args_json);
        } catch {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'args-json-parse', tool }) }],
            isError: true,
          };
        }
      }
      const outcome = invokeTool(spec, parsed);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(outcome.payload) }],
        isError: !outcome.ok,
      };
    },
  );
  return server;
}

export interface SearchHit {
  name: string;
  summary: string;
  score: number;
}

export function searchCatalog(query: string, limit: number): SearchHit[] {
  const docs = KITCHEN_SINK_TOOLS.map((tool) => ({
    name: tool.name,
    text: firstSentence(tool.description),
  }));
  return rankDocs(query, docs)
    .filter((hit) => hit.score > 0)
    .slice(0, limit)
    .map((hit) => ({ name: hit.name, summary: hit.text, score: roundScore(hit.score) }));
}

export function createLazyServer(): McpServer {
  const server = new McpServer({ name: 'kitchen-sink-lazy', version: '0.1.0' });
  server.registerTool(
    'diet_search',
    {
      description:
        'Search the full MCP catalog by tool name and one-line summary. Returns the top matches without input schemas. Pass the user request as the query. This does not execute a domain tool.',
      inputSchema: z.object({
        query: z.string().describe('User request text.'),
        limit: z.number().int().min(1).max(10).optional().describe('Maximum hits. Defaults to 5.'),
      }),
    },
    async ({ query, limit }) => {
      const hits = searchCatalog(query, limit ?? 5);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, hits }) }],
      };
    },
  );
  server.registerTool(
    'diet_call',
    {
      description:
        'Execute a domain tool by the exact name returned from diet_search. Pass args_json as a JSON object. The domain input schema is not standing context. The server validates arguments and lists any missing fields.',
      inputSchema: z.object({
        name: z.string().describe('Exact tool name from diet_search.'),
        args_json: z.string().optional().describe('JSON object of arguments.'),
      }),
    },
    async ({ name, args_json }) => {
      const spec = TOOL_BY_NAME.get(name);
      if (!spec) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'unknown-tool', name }) }],
          isError: true,
        };
      }
      let parsed: unknown = {};
      if (args_json && args_json.trim()) {
        try {
          parsed = JSON.parse(args_json);
        } catch {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: 'args-json-parse', name }) }],
            isError: true,
          };
        }
      }
      const outcome = invokeTool(spec, parsed);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(outcome.payload) }],
        isError: !outcome.ok,
      };
    },
  );
  return server;
}
