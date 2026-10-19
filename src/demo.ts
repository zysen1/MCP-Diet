// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanConfig } from './scan.js';
import { analyzeTraces } from './trace.js';
import { buildPlans, writePlans } from './plan.js';
import { runAb } from './harness.js';
import { demoResults, renderHtml } from './report.js';
import type { DemoResults } from './report.js';
import { KITCHEN_SINK_TOOLS } from './catalog.js';
import type { McpConfigFile } from './scan.js';
import type { TaskFile, TraceFile } from './types.js';

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export interface DemoPaths {
  root: string;
  docsDir: string;
  workDir: string;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function runDemo(paths: DemoPaths): Promise<DemoResults> {
  const config = await readJson<McpConfigFile>(path.join(paths.root, 'fixtures', 'mcp.json'));
  const traces = await readJson<TraceFile>(path.join(paths.root, 'fixtures', 'traces.json'));
  const tasks = await readJson<TaskFile>(path.join(paths.root, 'fixtures', 'tasks.json'));
  const scan = await scanConfig(config, paths.root);
  const known = new Set(KITCHEN_SINK_TOOLS.map((tool) => tool.name));
  const usage = analyzeTraces(traces, known, 1);
  const plans = buildPlans(scan, usage);
  await mkdir(paths.workDir, { recursive: true });
  await mkdir(paths.docsDir, { recursive: true });
  const launchEntry = config.mcpServers['kitchen-sink'];
  if (!launchEntry) throw new Error('fixtures/mcp.json is missing kitchen-sink');
  await writePlans(path.join(paths.workDir, 'plans'), plans, {
    command: launchEntry.command,
    args: launchEntry.args ?? [],
    cwd: paths.root,
    env: launchEntry.env,
  });
  await writeFile(path.join(paths.workDir, 'scan.json'), `${JSON.stringify(scan, null, 2)}\n`);
  await writeFile(path.join(paths.workDir, 'usage.json'), `${JSON.stringify(usage, null, 2)}\n`);
  const ab = await runAb(tasks.tasks, usage);
  const baseline = ab.arms.find((row) => row.arm === 'baseline');
  if (!baseline) throw new Error('missing baseline arm');
  if (baseline.schemaTokens !== scan.schemaTokens) {
    throw new Error(
      `stdio scan tokens ${scan.schemaTokens} did not match in-memory baseline ${baseline.schemaTokens}`,
    );
  }
  const results = demoResults({ scan, usage, plans, ab });
  const json = `${JSON.stringify(results, null, 2)}\n`;
  const html = renderHtml(results);
  await writeFile(path.join(paths.docsDir, 'demo-results.json'), json);
  await writeFile(path.join(paths.docsDir, 'demo-report.html'), html);
  await writeFile(path.join(paths.workDir, 'ab.json'), `${JSON.stringify(ab, null, 2)}\n`);
  return results;
}
