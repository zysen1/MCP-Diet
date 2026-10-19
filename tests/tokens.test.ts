// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { countTokens, firstSentence, toolWireTokens } from '../src/tokens.js';

test('o200k_base count for a fixed string', () => {
  assert.equal(countTokens('hello world'), 2);
  assert.equal(countTokens(''), 0);
});

test('tool wire text includes the schema and ignores key order of the input object', () => {
  const tokens = toolWireTokens({
    description: 'Hello.',
    name: 'demo',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  });
  assert.ok(tokens > 0);
  assert.equal(
    toolWireTokens({
      name: 'demo',
      description: 'Hello.',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    }),
    tokens,
  );
});

test('first sentence stops at the first period', () => {
  assert.equal(firstSentence('Create an issue. Legacy macro text.'), 'Create an issue.');
});
