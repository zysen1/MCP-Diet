// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { DISTRACTOR_BAIT, KITCHEN_SINK_TOOLS, invokeTool } from '../src/catalog.js';

test('catalog has 90 uniquely named tools and four distractors', () => {
  assert.equal(KITCHEN_SINK_TOOLS.length, 90);
  assert.equal(new Set(KITCHEN_SINK_TOOLS.map((tool) => tool.name)).size, 90);
  assert.equal(KITCHEN_SINK_TOOLS.filter((tool) => tool.role === 'distractor').length, 4);
  assert.deepEqual(Object.keys(DISTRACTOR_BAIT).sort(), [
    'calendar_create_event_from_template',
    'fs_read_file_archive',
    'github_create_issue_from_template',
    'linear_create_issue_from_template',
  ]);
});

test('invokeTool rejects missing required fields and echoes a complete call', () => {
  const spec = KITCHEN_SINK_TOOLS.find((tool) => tool.name === 'github_create_issue');
  assert.ok(spec);
  const missing = invokeTool(spec, {});
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.payload.missing, ['owner', 'repo', 'title']);
  const ok = invokeTool(spec, { owner: 'acme', repo: 'shop', title: 'flaky checkout' });
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.tool, 'github_create_issue');
});
