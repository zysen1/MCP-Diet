// SPDX-License-Identifier: Apache-2.0
import type { TraceFile, UsageReport } from './types.js';
import { DATASET_ID } from './types.js';

export function analyzeTraces(
  file: TraceFile,
  knownTools?: ReadonlySet<string>,
  minCount = 1,
): UsageReport {
  const counts = new Map<string, number>();
  let callCount = 0;
  for (const task of file.tasks) {
    for (const call of task.calls) {
      callCount += 1;
      counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1);
    }
  }
  const byTool = [...counts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
  const used = byTool.filter((row) => row.count >= minCount).map((row) => row.tool);
  const unknownTools = knownTools ? used.filter((tool) => !knownTools.has(tool)).sort() : [];
  const knownUsed = knownTools ? used.filter((tool) => knownTools.has(tool)) : used;
  return {
    dataset: file.dataset ?? DATASET_ID,
    minCount,
    callCount,
    byTool,
    used: knownUsed,
    unknownTools,
  };
}
