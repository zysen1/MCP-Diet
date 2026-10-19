// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeTraces } from '../src/trace.js';
import { runAb } from '../src/harness.js';
import { KITCHEN_SINK_TOOLS } from '../src/catalog.js';
import { buildPlans, renderDietCli } from '../src/plan.js';
import { parseSkill } from '../src/servers.js';
import { scanInMemory } from '../src/scan.js';
import { createKitchenSinkServer } from '../src/servers.js';
import type { TaskFile, TraceFile } from '../src/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadAb() {
  const traces = JSON.parse(await readFile(path.join(root, 'fixtures/traces.json'), 'utf8')) as TraceFile;
  const tasks = JSON.parse(await readFile(path.join(root, 'fixtures/tasks.json'), 'utf8')) as TaskFile;
  const known = new Set(KITCHEN_SINK_TOOLS.map((tool) => tool.name));
  const usage = analyzeTraces(traces, known, 1);
  const scan = await scanInMemory(createKitchenSinkServer(), 'kitchen-sink');
  const plans = buildPlans(
    {
      dataset: 'kitchen-sink-90',
      tokenizer: { library: 'gpt-tokenizer', encoding: 'o200k_base' },
      servers: [scan],
      toolCount: scan.toolCount,
      schemaTokens: scan.schemaTokens,
    },
    usage,
  );
  const ab = await runAb(tasks.tasks, usage);
  return { usage, plans, ab, tasks };
}

test('scripted A/B separates mock selection from the unrun LLM arm', async () => {
  const { ab, usage, plans } = await loadAb();
  assert.equal(ab.agent.kind, 'mock');
  assert.equal(ab.agent.id, 'scripted-lexical-v1');
  assert.equal(ab.realLlm.status, 'WIP');
  assert.equal(ab.realLlm.ran, false);
  assert.equal(usage.used.length, 14);
  assert.equal(plans.hotSet.length, 14);
  assert.ok(plans.dropped.includes('k8s_rollout_restart'));
  assert.equal(plans.skillTokens, ab.arms.find((arm) => arm.arm === 'cli-skill')?.instructionTokens);

  const byArm = Object.fromEntries(ab.arms.map((arm) => [arm.arm, arm]));
  assert.equal(byArm.baseline?.toolCount, 90);
  assert.equal(byArm.subset?.toolCount, 14);
  assert.equal(byArm['cli-skill']?.toolCount, 1);
  assert.equal(byArm.lazy?.toolCount, 2);
  assert.ok((byArm.baseline?.schemaTokens ?? 0) > (byArm.subset?.schemaTokens ?? 0));
  assert.ok((byArm.subset?.schemaTokens ?? 0) > (byArm.lazy?.schemaTokens ?? 0));
  assert.ok((byArm['cli-skill']?.schemaTokens ?? 0) < (byArm.subset?.schemaTokens ?? 0));
  assert.equal(byArm.baseline?.instructionTokens, 0);
  assert.ok((byArm['cli-skill']?.instructionTokens ?? 0) > 0);
  assert.equal(byArm.baseline?.selectionAccuracy, '7/12');
  assert.equal(byArm.baseline?.successRate, '7/12');
  assert.equal(byArm.subset?.selectionAccuracy, '11/12');
  assert.equal(byArm.subset?.successRate, '10/12');
  assert.equal(byArm['cli-skill']?.selectionAccuracy, '11/12');
  assert.equal(byArm['cli-skill']?.successRate, '10/12');
  assert.equal(byArm.lazy?.selectionAccuracy, '12/12');
  assert.equal(byArm.lazy?.successRate, '11/12');

  const cell = (taskId: string, arm: string) => ab.tasks.find((row) => row.taskId === taskId && row.arm === arm);
  assert.equal(cell('gh-create', 'baseline')?.reason, 'wrong-tool');
  assert.equal(cell('gh-create', 'baseline')?.selectedTool, 'github_create_issue_from_template');
  assert.equal(cell('gh-create', 'subset')?.success, true);
  assert.equal(cell('gh-create', 'cli-skill')?.success, true);
  assert.equal(cell('gh-create', 'lazy')?.success, true);
  assert.equal(cell('gh-create-missing-args', 'subset')?.reason, 'missing-args');
  assert.equal(cell('gh-create-missing-args', 'subset')?.selectionCorrect, true);
  assert.equal(cell('k8s-restart', 'subset')?.reason, 'pruned');
  assert.equal(cell('k8s-restart', 'cli-skill')?.reason, 'pruned');
  assert.equal(cell('k8s-restart', 'baseline')?.success, true);
  assert.equal(cell('k8s-restart', 'lazy')?.success, true);
  assert.equal(cell('fs-read', 'baseline')?.selectedTool, 'fs_read_file_archive');
  assert.equal(cell('fs-read', 'lazy')?.success, true);
  assert.equal(cell('sentry-health', 'baseline')?.success, true);
  assert.ok(parseSkill(plans.skill).some((row) => row.name === 'github_create_issue'));
  assert.ok(!parseSkill(plans.skill).some((row) => row.name === 'k8s_rollout_restart'));
});

test('generated CLI calls the mock server', async () => {
  await mkdir(path.join(root, 'demo-out'), { recursive: true });
  const dir = await mkdtemp(path.join(root, 'demo-out', 'cli-'));
  const cli = renderDietCli({
    command: process.execPath,
    args: ['--import', 'tsx', path.join(root, 'src/mock-stdio.js')],
  });
  const { writeFile } = await import('node:fs/promises');
  const file = path.join(dir, 'diet-cli.mjs');
  await writeFile(file, cli);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [file, 'github_list_issues', JSON.stringify({ owner: 'acme', repo: 'shop', state: 'open' })], {
      cwd: root,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`cli exit ${code}: ${err}`));
      else resolve(out);
    });
  });
  const parsed = JSON.parse(stdout) as { isError?: boolean; content?: Array<{ text?: string }> };
  assert.notEqual(parsed.isError, true);
  const text = parsed.content?.[0]?.text ?? '';
  assert.match(text, /"ok":true/);
  assert.match(text, /github_list_issues/);
});
