// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { scanConfig } from './scan.js';
import type { McpConfigFile } from './scan.js';
import { analyzeTraces } from './trace.js';
import { buildPlans, writePlans } from './plan.js';
import { runAb } from './harness.js';
import { repoRoot, runDemo } from './demo.js';
import { KITCHEN_SINK_TOOLS } from './catalog.js';
import type { ScanReport, TaskFile, TraceFile } from './types.js';

const HELP = `mcp-diet — measure MCP tool schemas and compare three diet plans

  mcp-diet scan --config fixtures/mcp.json --out demo-out/scan.json
  mcp-diet trace --traces fixtures/traces.json --scan demo-out/scan.json --out demo-out/usage.json
  mcp-diet plan --scan demo-out/scan.json --usage demo-out/usage.json --out demo-out/plans
  mcp-diet ab --tasks fixtures/tasks.json --usage demo-out/usage.json
  mcp-diet demo

demo scans the mock 90-tool server over stdio, writes three plans, and runs the
scripted A/B harness. It does not call a model and needs no API key.
Real-LLM evaluation is WIP.
`;

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string' },
      traces: { type: 'string' },
      tasks: { type: 'string' },
      scan: { type: 'string' },
      usage: { type: 'string' },
      out: { type: 'string' },
      docs: { type: 'string' },
      work: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    process.stdout.write(HELP);
    return;
  }
  const root = repoRoot();
  if (command === 'demo') {
    const results = await runDemo({
      root,
      docsDir: values.docs ? path.resolve(values.docs) : path.join(root, 'docs'),
      workDir: values.work ? path.resolve(values.work) : path.join(root, 'demo-out'),
    });
    const baseline = results.ab.arms.find((arm) => arm.arm === 'baseline');
    const subset = results.ab.arms.find((arm) => arm.arm === 'subset');
    process.stdout.write(
      `scanned ${results.scan.toolCount} tools, ${results.scan.schemaTokens} schema tokens\n` +
        `baseline selection ${baseline?.selectionAccuracy ?? '?'} success ${baseline?.successRate ?? '?'}\n` +
        `subset selection ${subset?.selectionAccuracy ?? '?'} success ${subset?.successRate ?? '?'}\n` +
        `real LLM ${results.ab.realLlm.status}\n`,
    );
    return;
  }
  if (command === 'scan') {
    if (!values.config || !values.out) throw new Error('scan requires --config and --out');
    const config = await readJson<McpConfigFile>(path.resolve(values.config));
    const report = await scanConfig(config, root);
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
    await writeFile(path.resolve(values.out), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${report.toolCount} tools, ${report.schemaTokens} schema tokens\n`);
    return;
  }
  if (command === 'trace') {
    if (!values.traces || !values.out) throw new Error('trace requires --traces and --out');
    const traces = await readJson<TraceFile>(path.resolve(values.traces));
    let known: Set<string> | undefined;
    if (values.scan) {
      const scan = await readJson<ScanReport>(path.resolve(values.scan));
      known = new Set(scan.servers.flatMap((server) => server.tools.map((tool) => tool.name)));
    } else {
      known = new Set(KITCHEN_SINK_TOOLS.map((tool) => tool.name));
    }
    const usage = analyzeTraces(traces, known, 1);
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
    await writeFile(path.resolve(values.out), `${JSON.stringify(usage, null, 2)}\n`);
    process.stdout.write(`${usage.used.length} tools used across ${usage.callCount} calls\n`);
    return;
  }
  if (command === 'plan') {
    if (!values.scan || !values.usage || !values.out) throw new Error('plan requires --scan, --usage, and --out');
    const scan = await readJson<ScanReport>(path.resolve(values.scan));
    const usage = await readJson<import('./types.js').UsageReport>(path.resolve(values.usage));
    const plans = buildPlans(scan, usage);
    const configPath = values.config ?? path.join(root, 'fixtures', 'mcp.json');
    const config = await readJson<McpConfigFile>(path.resolve(configPath));
    const entry = Object.values(config.mcpServers)[0];
    if (!entry) throw new Error('config has no mcpServers entry');
    await writePlans(path.resolve(values.out), plans, {
      command: entry.command,
      args: entry.args ?? [],
      env: entry.env,
    });
    process.stdout.write(`kept ${plans.hotSet.length}, dropped ${plans.dropped.length}, skill ${plans.skillTokens} tokens\n`);
    return;
  }
  if (command === 'ab') {
    if (!values.tasks || !values.usage) throw new Error('ab requires --tasks and --usage');
    const tasks = await readJson<TaskFile>(path.resolve(values.tasks));
    const usage = await readJson<import('./types.js').UsageReport>(path.resolve(values.usage));
    const report = await runAb(tasks.tasks, usage);
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (values.out) {
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
      await writeFile(path.resolve(values.out), text);
    } else {
      process.stdout.write(text);
    }
    return;
  }
  throw new Error(`unknown command ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
