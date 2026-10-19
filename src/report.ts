// SPDX-License-Identifier: Apache-2.0
import type { AbReport, ArmSummary, TaskArmResult } from './harness.js';
import type { ScanReport, UsageReport } from './types.js';

export interface DemoResults {
  dataset: string;
  label: string;
  tokenizer: { library: string; encoding: string };
  scan: {
    transport: 'stdio';
    server: string;
    toolCount: number;
    schemaTokens: number;
    tools: Array<{ name: string; tokens: number }>;
  };
  usage: {
    callCount: number;
    minCount: number;
    hotSet: string[];
    byTool: Array<{ tool: string; count: number }>;
    unknownTools: string[];
  };
  plans: {
    baselineSchemaTokens: number;
    subsetSchemaTokens: number;
    dropped: number;
    skillTokens: number;
  };
  ab: AbReport;
  notes: string[];
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '0.0%';
  return `${(Math.round((part / whole) * 1000) / 10).toFixed(1)}%`;
}

function reduction(baseline: number, value: number): string {
  if (baseline === 0) return '0.0%';
  return pct(baseline - value, baseline);
}

function arm(report: AbReport, id: ArmSummary['arm']): ArmSummary {
  const found = report.arms.find((row) => row.arm === id);
  if (!found) throw new Error(`missing arm ${id}`);
  return found;
}

function statusClass(row: TaskArmResult): string {
  if (row.success) return 'ok';
  if (row.reason === 'missing-args') return 'warn';
  return 'bad';
}

function statusLabel(row: TaskArmResult): string {
  if (row.success) return 'success';
  if (row.reason === 'missing-args') return 'right tool, missing args';
  if (row.reason === 'pruned') return 'pruned';
  if (row.reason === 'wrong-tool') return 'wrong tool';
  if (row.reason === 'no-selection') return 'no selection';
  return row.reason;
}

export function renderHtml(results: DemoResults): string {
  const ab = results.ab;
  const baseline = arm(ab, 'baseline');
  const maxSchema = Math.max(...ab.arms.map((row) => row.schemaTokens), 1);
  const maxTotal = Math.max(...ab.arms.map((row) => row.meanTotalContextTokens), 1);
  const taskIds = [...new Set(ab.tasks.map((row) => row.taskId))];
  const heaviest = [...results.scan.tools].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name)).slice(0, 8);

  const bars = (rows: ArmSummary[], pick: (row: ArmSummary) => number, max: number) =>
    rows
      .map((row) => {
        const value = pick(row);
        const width = Math.max(1, Math.round((value / max) * 100));
        return `<div class="bar-row"><div class="bar-label">${esc(row.arm)}</div><div class="bar-track"><div class="bar-fill arm-${esc(row.arm)}" style="width:${width}%"></div></div><div class="bar-value">${value.toLocaleString('en-US')}</div></div>`;
      })
      .join('');

  const armRows = ab.arms
    .map((row) => {
      const standing = row.schemaTokens + row.instructionTokens;
      return `<tr>
        <td>${esc(row.arm)}</td>
        <td class="num">${row.toolCount}</td>
        <td class="num">${row.schemaTokens.toLocaleString('en-US')}</td>
        <td class="num">${row.instructionTokens.toLocaleString('en-US')}</td>
        <td class="num">${standing.toLocaleString('en-US')}</td>
        <td class="num">${reduction(baseline.schemaTokens, standing)}</td>
        <td class="num">${row.meanResultTokens.toLocaleString('en-US')}</td>
        <td class="num">${row.meanTotalContextTokens.toLocaleString('en-US')}</td>
        <td class="num">${esc(row.selectionAccuracy)}</td>
        <td class="num">${esc(row.successRate)}</td>
      </tr>`;
    })
    .join('');

  const matrixRows = taskIds
    .map((taskId) => {
      const cells = ab.arms
        .map((summary) => {
          const row = ab.tasks.find((item) => item.taskId === taskId && item.arm === summary.arm);
          if (!row) return '<td></td>';
          const selected = row.selectedTool ?? '—';
          return `<td class="${statusClass(row)}"><div class="tool">${esc(selected)}</div><div class="why">${esc(statusLabel(row))}</div></td>`;
        })
        .join('');
      const gold = ab.tasks.find((item) => item.taskId === taskId)?.goldTool ?? '';
      return `<tr><td>${esc(taskId)}</td><td class="gold">${esc(gold)}</td>${cells}</tr>`;
    })
    .join('');

  const heavyRows = heaviest
    .map((tool) => `<tr><td>${esc(tool.name)}</td><td class="num">${tool.tokens.toLocaleString('en-US')}</td></tr>`)
    .join('');

  const notes = results.notes.map((note) => `<li>${esc(note)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>MCP Diet offline report</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f0e6; color: #1c1915; font: 16px/1.45 "Segoe UI", Helvetica, Arial, sans-serif; }
  main { max-width: 1080px; margin: 0 auto; padding: 28px 20px 48px; }
  h1 { font-size: 34px; line-height: 1.1; margin: 0 0 8px; letter-spacing: -0.03em; }
  h2 { font-size: 20px; margin: 32px 0 10px; }
  p { margin: 0 0 12px; }
  .banner { background: #1c1915; color: #f4f0e6; padding: 12px 16px; border-radius: 10px; margin: 16px 0 20px; }
  .banner strong { color: #f2c14e; }
  .muted { color: #5e584e; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .card { background: #fffdf8; border: 1px solid #e3dac8; border-radius: 12px; padding: 14px 16px; }
  .card .k { color: #5e584e; font-size: 13px; }
  .card .v { font-size: 26px; font-weight: 650; letter-spacing: -0.03em; margin-top: 4px; }
  .panel { background: #fffdf8; border: 1px solid #e3dac8; border-radius: 12px; padding: 16px; margin: 12px 0; }
  .bar-row { display: grid; grid-template-columns: 110px 1fr 90px; gap: 8px; align-items: center; margin: 6px 0; }
  .bar-label { font-size: 14px; }
  .bar-track { background: #efe8da; border-radius: 999px; height: 14px; }
  .bar-fill { height: 14px; border-radius: 999px; }
  .bar-value { text-align: right; font-variant-numeric: tabular-nums; font-size: 14px; }
  .arm-baseline { background: #8a5a12; }
  .arm-subset { background: #1f7a4d; }
  .arm-cli-skill { background: #1d4e89; }
  .arm-lazy { background: #5b3d8a; }
  table { width: 100%; border-collapse: collapse; background: #fffdf8; table-layout: fixed; }
  th, td { border-bottom: 1px solid #e3dac8; padding: 8px 6px; text-align: left; vertical-align: top; font-size: 13px; overflow-wrap: anywhere; }
  th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #5e584e; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  td.ok { background: #e7f5ee; }
  td.warn { background: #fff4d6; }
  td.bad { background: #fde8e2; }
  .tool { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  .why { color: #5e584e; font-size: 12px; }
  .gold { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  ul { margin: 8px 0 0 18px; padding: 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
</style>
</head>
<body>
<main>
  <p class="muted">Dataset ${esc(results.dataset)} · ${esc(results.label)}</p>
  <h1>MCP Diet offline report</h1>
  <p>Schema tokens are ${esc(results.tokenizer.library)} ${esc(results.tokenizer.encoding)} counts of each <code>tools/list</code> JSON object. Selection numbers are from the scripted agent only.</p>
  <div class="banner">Mock tool-selection. Agent <strong>${esc(ab.agent.id)}</strong>. Real LLM: <strong>${esc(ab.realLlm.status)}</strong> — not run.</div>
  <section class="cards">
    <div class="card"><div class="k">Tools scanned</div><div class="v">${results.scan.toolCount}</div></div>
    <div class="card"><div class="k">Baseline schema tokens</div><div class="v">${baseline.schemaTokens.toLocaleString('en-US')}</div></div>
    <div class="card"><div class="k">Hot set</div><div class="v">${results.usage.hotSet.length}</div></div>
    <div class="card"><div class="k">Subset schema vs baseline</div><div class="v">${reduction(baseline.schemaTokens, arm(ab, 'subset').schemaTokens)}</div></div>
  </section>
  <h2>Standing schema tokens</h2>
  <div class="panel">${bars(ab.arms, (row) => row.schemaTokens, maxSchema)}</div>
  <p class="muted">CLI skill and lazy loading also put text outside the tool list. The next chart adds server instructions, the task prompt, and tool-result text for one scripted turn.</p>
  <h2>Mean context tokens per task</h2>
  <div class="panel">${bars(ab.arms, (row) => row.meanTotalContextTokens, maxTotal)}</div>
  <h2>A/B on the fixed task set</h2>
  <table>
    <thead>
      <tr>
        <th>Arm</th><th class="num">Tools</th><th class="num">Schema</th><th class="num">Instructions</th>
        <th class="num">Standing</th><th class="num">Schema cut</th><th class="num">Mean result</th>
        <th class="num">Mean total</th><th class="num">Selection</th><th class="num">Success</th>
      </tr>
    </thead>
    <tbody>${armRows}</tbody>
  </table>
  <p class="muted">Standing = schema tokens + instruction tokens. Schema cut compares that standing total with the baseline schema total. Selection is the fraction of tasks whose domain tool matched the gold tool. Success also requires the mock call to return ok.</p>
  <h2>Per-task outcomes</h2>
  <table>
    <thead>
      <tr><th>Task</th><th>Gold</th>${ab.arms.map((row) => `<th>${esc(row.arm)}</th>`).join('')}</tr>
    </thead>
    <tbody>${matrixRows}</tbody>
  </table>
  <h2>Heaviest tool schemas</h2>
  <table>
    <thead><tr><th>Tool</th><th class="num">Tokens</th></tr></thead>
    <tbody>${heavyRows}</tbody>
  </table>
  <h2>How these numbers were produced</h2>
  <ul>${notes}</ul>
</main>
</body>
</html>
`;
}

export function demoResults(input: {
  scan: ScanReport;
  usage: UsageReport;
  plans: { subsetSchemaTokens: number; skillTokens: number; baselineSchemaTokens: number; dropped: string[] };
  ab: AbReport;
}): DemoResults {
  const server = input.scan.servers[0];
  if (!server || server.transport !== 'stdio') {
    throw new Error('demo results expect a stdio scan');
  }
  return {
    dataset: input.ab.dataset,
    label: 'offline fixture run, no API key',
    tokenizer: input.scan.tokenizer,
    scan: {
      transport: 'stdio',
      server: server.server,
      toolCount: server.toolCount,
      schemaTokens: server.schemaTokens,
      tools: server.tools.map((tool) => ({ name: tool.name, tokens: tool.tokens })),
    },
    usage: {
      callCount: input.usage.callCount,
      minCount: input.usage.minCount,
      hotSet: input.usage.used,
      byTool: input.usage.byTool,
      unknownTools: input.usage.unknownTools,
    },
    plans: {
      baselineSchemaTokens: input.plans.baselineSchemaTokens,
      subsetSchemaTokens: input.plans.subsetSchemaTokens,
      dropped: input.plans.dropped.length,
      skillTokens: input.plans.skillTokens,
    },
    ab: input.ab,
    notes: [
      'The mock server exposed 90 tools over stdio. The scanner connected with the official MCP client and counted tokens on each tools/list object.',
      'Historical traces mark the hot set. Tools with at least one recorded call stay. The rest are dropped by the subset and CLI skill plans.',
      'Four catalog tools repeat a rare phrase from one eval prompt inside a long description. The scripted agent scores that full text on the baseline arm.',
      'CLI skill and lazy search score the one-line headline only. Lazy search still sees every tool. The subset and the CLI skill do not.',
      'One task asks for a tool that never appears in the traces, so usage-based plans prune it. One task names the right tool but omits required arguments.',
      'Real LLM runs were not executed. Selection and success rates are mock pipeline results for scripted-lexical-v1 on kitchen-sink-90.',
      'Token counts estimate tool-definition text with o200k_base. They are not a provider invoice. Anthropic and OpenAI tokenizers differ, and this count omits system prompts other than the diet skill instructions.',
    ],
  };
}
