// SPDX-License-Identifier: Apache-2.0
import { RANK, rankDocs, roundScore } from './rank.js';
import { extractArgs } from './extract.js';
import { parseSkill } from './servers.js';
import type { ArmId } from './types.js';

export const AGENT_ID = RANK.id;

export interface VisibleTool {
  name: string;
  description: string;
}

export interface ToolCallResult {
  isError?: boolean;
  content?: ReadonlyArray<{ type: string; text?: string }>;
}

export interface AgentCall {
  tool: string;
  args: Record<string, unknown>;
  resultText: string;
  ok: boolean;
}

export interface AgentRun {
  arm: ArmId;
  selectedTool: string | null;
  calls: AgentCall[];
  candidates: Array<{ name: string; score: number }>;
}

export interface AgentSurface {
  arm: ArmId;
  tools: VisibleTool[];
  instructions: string;
  call: (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
}

function resultText(result: ToolCallResult): string {
  return (result.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('\n');
}

function payloadOk(result: ToolCallResult): boolean {
  if (result.isError) return false;
  const text = resultText(result);
  try {
    const parsed = JSON.parse(text) as { ok?: boolean };
    return parsed.ok === true;
  } catch {
    return false;
  }
}

async function invoke(
  surface: AgentSurface,
  tool: string,
  args: Record<string, unknown>,
): Promise<AgentCall> {
  try {
    const result = await surface.call(tool, args);
    return { tool, args, resultText: resultText(result), ok: payloadOk(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { tool, args, resultText: message, ok: false };
  }
}

function topCandidates(ranked: Array<{ name: string; score: number }>): Array<{ name: string; score: number }> {
  return ranked.slice(0, 3).map((row) => ({ name: row.name, score: roundScore(row.score) }));
}

/**
 * Scripted lexical agent.
 * baseline/subset: rank full descriptions, call the top tool.
 * cli-skill: rank the skill table, call diet_exec.
 * lazy: call diet_search and take hit 1, then diet_call. It does not re-rank.
 */
export async function runScriptedAgent(task: { id: string; prompt: string }, surface: AgentSurface): Promise<AgentRun> {
  if (surface.arm === 'lazy') {
    const search = await invoke(surface, 'diet_search', { query: task.prompt, limit: 5 });
    let selected: string | null = null;
    let hits: Array<{ name: string; score: number }> = [];
    try {
      const parsed = JSON.parse(search.resultText) as { hits?: Array<{ name: string; score: number }> };
      hits = (parsed.hits ?? []).map((hit) => ({ name: hit.name, score: hit.score }));
      selected = hits[0]?.name ?? null;
    } catch {
      selected = null;
    }
    const calls = [search];
    if (selected) {
      const args = extractArgs(selected, task.prompt);
      calls.push(
        await invoke(surface, 'diet_call', { name: selected, args_json: JSON.stringify(args) }),
      );
    }
    return { arm: surface.arm, selectedTool: selected, calls, candidates: topCandidates(hits) };
  }

  if (surface.arm === 'cli-skill') {
    const rows = parseSkill(surface.instructions);
    const ranked = rankDocs(
      task.prompt,
      rows.map((row) => ({ name: row.name, text: row.summary })),
    );
    const best = ranked[0];
    const selected = best && best.score > 0 ? best.name : null;
    const calls: AgentCall[] = [];
    if (selected) {
      const args = extractArgs(selected, task.prompt);
      calls.push(
        await invoke(surface, 'diet_exec', { tool: selected, args_json: JSON.stringify(args) }),
      );
    }
    return { arm: surface.arm, selectedTool: selected, calls, candidates: topCandidates(ranked) };
  }

  const ranked = rankDocs(
    task.prompt,
    surface.tools.map((tool) => ({ name: tool.name, text: tool.description })),
  );
  const best = ranked[0];
  const selected = best && best.score > 0 ? best.name : null;
  const calls: AgentCall[] = [];
  if (selected) {
    calls.push(await invoke(surface, selected, extractArgs(selected, task.prompt)));
  }
  return { arm: surface.arm, selectedTool: selected, calls, candidates: topCandidates(ranked) };
}

export const REAL_LLM = {
  status: 'WIP' as const,
  ran: false,
  reason:
    'No real LLM was called. This run only executed scripted-lexical-v1. Tool-selection and success rates below are mock pipeline results, not model measurements.',
};
