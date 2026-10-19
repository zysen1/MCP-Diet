// SPDX-License-Identifier: Apache-2.0
import { KITCHEN_SINK_TOOLS } from './catalog.js';
import { countTokens, TOKENIZER } from './tokens.js';
import { connectInMemory, measureTools } from './scan.js';
import { createCliSkillServer, createKitchenSinkServer, createLazyServer } from './servers.js';
import { AGENT_ID, REAL_LLM, runScriptedAgent } from './agent.js';
import type { AgentRun } from './agent.js';
import type { ArmId, FailureReason, TaskFixture, UsageReport } from './types.js';
import { DATASET_ID } from './types.js';

const ARMS: readonly ArmId[] = ['baseline', 'subset', 'cli-skill', 'lazy'];

export interface TaskArmResult {
  taskId: string;
  arm: ArmId;
  goldTool: string;
  selectedTool: string | null;
  goldOnSurface: boolean;
  selectionCorrect: boolean;
  success: boolean;
  reason: FailureReason;
  schemaTokens: number;
  instructionTokens: number;
  promptTokens: number;
  resultTokens: number;
  totalContextTokens: number;
  candidates: Array<{ name: string; score: number }>;
  calls: Array<{ tool: string; ok: boolean }>;
}

export interface ArmSummary {
  arm: ArmId;
  toolCount: number;
  schemaTokens: number;
  instructionTokens: number;
  tasks: number;
  selectionCorrect: number;
  successes: number;
  selectionAccuracy: string;
  successRate: string;
  resultTokensTotal: number;
  meanResultTokens: number;
  meanTotalContextTokens: number;
}

export interface AbReport {
  dataset: string;
  agent: {
    id: string;
    kind: 'mock';
    policy: string;
  };
  realLlm: typeof REAL_LLM;
  tokenizer: { library: string; encoding: string };
  hotSet: string[];
  arms: ArmSummary[];
  tasks: TaskArmResult[];
}

function fraction(count: number, total: number): string {
  return `${count}/${total}`;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function reasonFor(input: {
  goldOnSurface: boolean;
  selected: string | null;
  gold: string;
  finalOk: boolean;
  hadCall: boolean;
}): FailureReason {
  if (!input.goldOnSurface) return 'pruned';
  if (!input.selected || !input.hadCall) return 'no-selection';
  if (input.selected !== input.gold) return 'wrong-tool';
  if (!input.finalOk) return 'missing-args';
  return 'success';
}

async function runArm(
  arm: ArmId,
  tasks: readonly TaskFixture[],
  hotSet: readonly string[],
): Promise<{ summary: Omit<ArmSummary, 'tasks' | 'selectionCorrect' | 'successes' | 'selectionAccuracy' | 'successRate' | 'resultTokensTotal' | 'meanResultTokens' | 'meanTotalContextTokens'>; rows: TaskArmResult[] }> {
  const hot = new Set(hotSet);
  const server =
    arm === 'baseline'
      ? createKitchenSinkServer()
      : arm === 'subset'
        ? createKitchenSinkServer({ allow: hot })
        : arm === 'cli-skill'
          ? createCliSkillServer(hotSet)
          : createLazyServer();
  const session = await connectInMemory(server);
  try {
    const measured = await measureTools(session.client, arm, 'in-memory');
    const instructions = session.client.getInstructions() ?? '';
    const instructionTokens = instructions.length === 0 ? 0 : countTokens(instructions);
    const visibleNames = new Set(measured.tools.map((tool) => tool.name));
    const universe =
      arm === 'lazy'
        ? new Set(KITCHEN_SINK_TOOLS.map((tool) => tool.name))
        : arm === 'cli-skill'
          ? hot
          : visibleNames;
    const rows: TaskArmResult[] = [];
    for (const task of tasks) {
      const promptTokens = countTokens(task.prompt);
      const run: AgentRun = await runScriptedAgent(
        { id: task.id, prompt: task.prompt },
        {
          arm,
          tools: measured.tools.map((tool) => ({ name: tool.name, description: tool.description })),
          instructions,
          call: async (name, args) => session.client.callTool({ name, arguments: args }),
        },
      );
      const resultTokens = run.calls.reduce((sum, call) => sum + countTokens(call.resultText), 0);
      const finalCall = run.calls.at(-1);
      const hadDomainCall =
        arm === 'lazy' ? run.calls.some((call) => call.tool === 'diet_call') : run.calls.length > 0;
      const finalOk = hadDomainCall ? (finalCall?.ok ?? false) : false;
      const goldOnSurface = universe.has(task.goldTool);
      const selectionCorrect = run.selectedTool === task.goldTool;
      const success = selectionCorrect && finalOk;
      rows.push({
        taskId: task.id,
        arm,
        goldTool: task.goldTool,
        selectedTool: run.selectedTool,
        goldOnSurface,
        selectionCorrect,
        success,
        reason: reasonFor({
          goldOnSurface,
          selected: run.selectedTool,
          gold: task.goldTool,
          finalOk,
          hadCall: hadDomainCall,
        }),
        schemaTokens: measured.schemaTokens,
        instructionTokens,
        promptTokens,
        resultTokens,
        totalContextTokens: measured.schemaTokens + instructionTokens + promptTokens + resultTokens,
        candidates: run.candidates,
        calls: run.calls.map((call) => ({ tool: call.tool, ok: call.ok })),
      });
    }
    return {
      summary: {
        arm,
        toolCount: measured.toolCount,
        schemaTokens: measured.schemaTokens,
        instructionTokens,
      },
      rows,
    };
  } finally {
    await session.close();
  }
}

export async function runAb(tasks: readonly TaskFixture[], usage: UsageReport): Promise<AbReport> {
  const hotSet = usage.used;
  const allRows: TaskArmResult[] = [];
  const arms: ArmSummary[] = [];
  for (const arm of ARMS) {
    const result = await runArm(arm, tasks, hotSet);
    allRows.push(...result.rows);
    const selectionCorrect = result.rows.filter((row) => row.selectionCorrect).length;
    const successes = result.rows.filter((row) => row.success).length;
    const resultTokensTotal = result.rows.reduce((sum, row) => sum + row.resultTokens, 0);
    const totalContext = result.rows.reduce((sum, row) => sum + row.totalContextTokens, 0);
    const taskCount = result.rows.length;
    arms.push({
      ...result.summary,
      tasks: taskCount,
      selectionCorrect,
      successes,
      selectionAccuracy: fraction(selectionCorrect, taskCount),
      successRate: fraction(successes, taskCount),
      resultTokensTotal,
      meanResultTokens: oneDecimal(taskCount === 0 ? 0 : resultTokensTotal / taskCount),
      meanTotalContextTokens: oneDecimal(taskCount === 0 ? 0 : totalContext / taskCount),
    });
  }
  return {
    dataset: DATASET_ID,
    agent: {
      id: AGENT_ID,
      kind: 'mock',
      policy:
        'BM25 over tool name (weight 2) and text. Baseline and subset score the full description. CLI skill scores one-line summaries of the hot set. Lazy search scores one-line summaries of the full catalog; the agent takes the top hit. Ties break toward the shorter text, then the name.',
    },
    realLlm: REAL_LLM,
    tokenizer: { library: TOKENIZER.library, encoding: TOKENIZER.encoding },
    hotSet,
    arms,
    tasks: allRows,
  };
}
