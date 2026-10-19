// SPDX-License-Identifier: Apache-2.0
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import type { McpServer } from '@modelcontextprotocol/server';
import { TOKENIZER, toolWireText, countTokens } from './tokens.js';
import type { MeasuredTool, ScanReport, ServerScan, StdioLaunch } from './types.js';
import { DATASET_ID } from './types.js';

const CLIENT_INFO = { name: 'mcp-diet', version: '0.1.0' };

export async function connectInMemory(server: McpServer): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(CLIENT_INFO);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export async function measureTools(
  client: Client,
  server: string,
  transport: ServerScan['transport'],
): Promise<ServerScan> {
  const listed = await client.listTools();
  const tools: MeasuredTool[] = listed.tools.map((tool) => {
    const text = toolWireText(tool);
    return {
      server,
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? {},
      tokens: countTokens(text),
      chars: text.length,
    };
  });
  tools.sort((a, b) => a.name.localeCompare(b.name));
  const schemaTokens = tools.reduce((sum, tool) => sum + tool.tokens, 0);
  return { server, transport, toolCount: tools.length, schemaTokens, tools };
}

export async function scanInMemory(server: McpServer, name: string): Promise<ServerScan> {
  const session = await connectInMemory(server);
  try {
    return await measureTools(session.client, name, 'in-memory');
  } finally {
    await session.close();
  }
}

export async function scanStdio(launch: StdioLaunch & { name: string }): Promise<ServerScan> {
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: { ...getDefaultEnvironment(), ...launch.env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });
  const client = new Client(CLIENT_INFO);
  try {
    await client.connect(transport);
    return await measureTools(client, launch.name, 'stdio');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`stdio scan of ${launch.name} failed: ${message}\n${stderr}`);
  } finally {
    await client.close();
  }
}

export function scanReport(servers: ServerScan[], dataset = DATASET_ID): ScanReport {
  return {
    dataset,
    tokenizer: { library: TOKENIZER.library, encoding: TOKENIZER.encoding },
    servers,
    toolCount: servers.reduce((sum, server) => sum + server.toolCount, 0),
    schemaTokens: servers.reduce((sum, server) => sum + server.schemaTokens, 0),
  };
}

export interface McpConfigFile {
  mcpServers: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  >;
}

export async function scanConfig(config: McpConfigFile, cwd: string): Promise<ScanReport> {
  const servers: ServerScan[] = [];
  const names = Object.keys(config.mcpServers).sort();
  for (const name of names) {
    const entry = config.mcpServers[name];
    if (!entry) continue;
    servers.push(
      await scanStdio({
        name,
        command: entry.command,
        args: entry.args ?? [],
        env: entry.env,
        cwd: entry.cwd ?? cwd,
      }),
    );
  }
  return scanReport(servers);
}
