// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKitchenSinkServer } from '../src/servers.js';
import { scanInMemory, scanStdio } from '../src/scan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('in-memory listTools returns 90 tools with schema tokens', async () => {
  const scan = await scanInMemory(createKitchenSinkServer(), 'kitchen-sink');
  assert.equal(scan.toolCount, 90);
  assert.ok(scan.schemaTokens > 10000);
  const issue = scan.tools.find((tool) => tool.name === 'github_create_issue');
  assert.ok(issue);
  assert.match(issue.description, /^Create an issue in a GitHub repository\./);
  const schema = JSON.stringify(issue.inputSchema);
  assert.match(schema, /owner/);
});

test('stdio scan matches the in-memory schema token total', async () => {
  const memory = await scanInMemory(createKitchenSinkServer(), 'kitchen-sink');
  const stdio = await scanStdio({
    name: 'kitchen-sink',
    command: process.execPath,
    args: ['--import', 'tsx', path.join(root, 'src/mock-stdio.js')],
    cwd: root,
  });
  assert.equal(stdio.transport, 'stdio');
  assert.equal(stdio.toolCount, 90);
  assert.equal(stdio.schemaTokens, memory.schemaTokens);
  assert.deepEqual(
    stdio.tools.map((tool) => [tool.name, tool.tokens]),
    memory.tools.map((tool) => [tool.name, tool.tokens]),
  );
});

test('allowlist env on the stdio server drops unused tools', async () => {
  const scan = await scanStdio({
    name: 'kitchen-sink',
    command: process.execPath,
    args: ['--import', 'tsx', path.join(root, 'src/mock-stdio.js')],
    cwd: root,
    env: { MCP_DIET_ALLOWLIST: 'github_list_issues,slack_post_message' },
  });
  assert.deepEqual(
    scan.tools.map((tool) => tool.name),
    ['github_list_issues', 'slack_post_message'],
  );
});
