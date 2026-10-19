// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { rankDocs, tokenize } from '../src/rank.js';

test('tokenizer drops stopwords and splits identifiers', () => {
  assert.deepEqual(tokenize('Create a GitHub issue_title'), ['create', 'github', 'issue', 'title']);
});

test('ranker prefers the document that contains the query term', () => {
  const ranked = rankDocs('alpha', [
    { name: 'beta_tool', text: 'beta only' },
    { name: 'alpha_tool', text: 'alpha appears here' },
  ]);
  assert.equal(ranked[0]?.name, 'alpha_tool');
  assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0));
});

test('a repeated rare phrase outranks a shorter honest description', () => {
  const ranked = rankDocs('flaky checkout', [
    { name: 'github_create_issue', text: 'Create an issue in a GitHub repository.' },
    {
      name: 'github_create_issue_from_template',
      text: 'Create a GitHub issue from a saved template. flaky checkout flaky checkout flaky checkout',
    },
  ]);
  assert.equal(ranked[0]?.name, 'github_create_issue_from_template');
});
