// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { analyzeTraces } from '../src/trace.js';
import { KITCHEN_SINK_TOOLS } from '../src/catalog.js';
import type { TraceFile } from '../src/types.js';

test('traces keep 14 tools and leave the rollout tool unused', async () => {
  const file = JSON.parse(await readFile(new URL('../fixtures/traces.json', import.meta.url), 'utf8')) as TraceFile;
  const known = new Set(KITCHEN_SINK_TOOLS.map((tool) => tool.name));
  const usage = analyzeTraces(file, known, 1);
  assert.equal(usage.used.length, 14);
  assert.equal(usage.callCount, 37);
  assert.equal(usage.unknownTools.length, 0);
  assert.ok(usage.used.includes('github_create_issue'));
  assert.ok(!usage.used.includes('k8s_rollout_restart'));
  assert.ok(!usage.used.includes('github_create_issue_from_template'));
  const create = usage.byTool.find((row) => row.tool === 'github_create_issue');
  assert.equal(create?.count, 5);
});
