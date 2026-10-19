// SPDX-License-Identifier: Apache-2.0
import { countTokens as countO200k } from 'gpt-tokenizer/encoding/o200k_base';

/** What the counter is. Provider bills will not match this exactly. */
export const TOKENIZER = {
  library: 'gpt-tokenizer',
  encoding: 'o200k_base',
} as const;

export function countTokens(text: string): number {
  return countO200k(text);
}

/**
 * Canonical text of one tools/list entry.
 * Key order is fixed so the count does not depend on SDK object enumeration.
 * inputSchema is included as the server sent it.
 */
export function toolWireText(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
  title?: string;
}): string {
  const payload: Record<string, unknown> = {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  };
  if (tool.title) payload.title = tool.title;
  return JSON.stringify(payload);
}

export function toolWireTokens(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
  title?: string;
}): number {
  return countTokens(toolWireText(tool));
}

/** First sentence, used as the one-line summary for skill rows and lazy search. */
export function firstSentence(description: string): string {
  const trimmed = description.trim();
  const idx = trimmed.indexOf('. ');
  if (idx === -1) return trimmed;
  return trimmed.slice(0, idx + 1);
}
