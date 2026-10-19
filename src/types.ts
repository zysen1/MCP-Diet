// SPDX-License-Identifier: Apache-2.0

export const DATASET_ID = 'kitchen-sink-90';

export interface FieldSpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  description: string;
  required: boolean;
  enumValues?: readonly [string, ...string[]];
}

export type ToolRole = 'primary' | 'distractor' | 'filler';

export interface ToolSpec {
  name: string;
  family: string;
  role: ToolRole;
  headline: string;
  description: string;
  fields: FieldSpec[];
}

export interface MeasuredTool {
  server: string;
  name: string;
  description: string;
  inputSchema: unknown;
  tokens: number;
  chars: number;
}

export interface ServerScan {
  server: string;
  transport: 'stdio' | 'in-memory';
  toolCount: number;
  schemaTokens: number;
  tools: MeasuredTool[];
}

export interface ScanReport {
  dataset: string;
  tokenizer: { library: string; encoding: string };
  servers: ServerScan[];
  toolCount: number;
  schemaTokens: number;
}

export interface TraceCall {
  server?: string;
  tool: string;
  arguments?: Record<string, unknown>;
}

export interface TraceTask {
  id: string;
  prompt?: string;
  calls: TraceCall[];
}

export interface TraceFile {
  dataset?: string;
  tasks: TraceTask[];
}

export interface ToolUsage {
  tool: string;
  count: number;
}

export interface UsageReport {
  dataset: string;
  minCount: number;
  callCount: number;
  byTool: ToolUsage[];
  used: string[];
  unknownTools: string[];
}

export interface TaskFixture {
  id: string;
  prompt: string;
  goldTool: string;
}

export interface TaskFile {
  dataset?: string;
  tasks: TaskFixture[];
}

export type ArmId = 'baseline' | 'subset' | 'cli-skill' | 'lazy';

export type FailureReason =
  | 'success'
  | 'missing-args'
  | 'wrong-tool'
  | 'pruned'
  | 'no-selection'
  | 'call-error';

export interface StdioLaunch {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}
