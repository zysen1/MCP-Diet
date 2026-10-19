// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('README quotes this run and keeps mock results separate from the real LLM', async () => {
  const results = JSON.parse(await readFile(path.join(root, 'docs/demo-results.json'), 'utf8')) as {
    dataset: string;
    scan: { schemaTokens: number; toolCount: number };
    ab: {
      agent: { id: string; kind: string };
      realLlm: { status: string; ran: boolean };
      arms: Array<{ arm: string; schemaTokens: number; selectionAccuracy: string; successRate: string; meanTotalContextTokens: number }>;
    };
  };
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const html = await readFile(path.join(root, 'docs/demo-report.html'), 'utf8');
  assert.equal(results.dataset, 'kitchen-sink-90');
  assert.equal(results.ab.agent.kind, 'mock');
  assert.equal(results.ab.realLlm.ran, false);
  assert.equal(results.ab.realLlm.status, 'WIP');
  for (const needle of [
    results.dataset,
    results.ab.agent.id,
    String(results.scan.schemaTokens),
    'WIP',
    'https://news.ycombinator.com/item?id=49906637',
    'https://news.ycombinator.com/item?id=49779329',
    'https://x.com/nereasolenne/status/2098091484717134001',
    'https://x.com/AgentGlassInc/status/2102525483443474537',
    'https://arxiv.org/abs/2609.11999',
    'https://arxiv.org/abs/2610.18522',
  ]) {
    assert.ok(readme.includes(needle), `README missing ${needle}`);
  }
  assert.ok(html.includes('WIP'));
  assert.ok(html.includes(results.ab.agent.id));
  assert.ok(html.includes(results.scan.schemaTokens.toLocaleString('en-US')));
  for (const arm of results.ab.arms) {
    assert.ok(readme.includes(arm.selectionAccuracy), arm.arm);
    assert.ok(readme.includes(arm.successRate), arm.arm);
    assert.ok(readme.includes(String(arm.meanTotalContextTokens)), arm.arm);
  }
  const png = await stat(path.join(root, 'docs/demo-report.png'));
  assert.ok(png.size > 50_000);
});
