// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { extractArgs } from '../src/extract.js';
import type { TaskFile } from '../src/types.js';

test('extractors fill required arguments for the fixed prompts', async () => {
  const file = JSON.parse(await readFile(new URL('../fixtures/tasks.json', import.meta.url), 'utf8')) as TaskFile;
  const prompt = (id: string) => {
    const task = file.tasks.find((item) => item.id === id);
    assert.ok(task);
    return task.prompt;
  };
  assert.deepEqual(extractArgs('github_create_issue', prompt('gh-create')), {
    owner: 'acme',
    repo: 'shop',
    title: 'flaky checkout',
    labels: ['bug'],
  });
  assert.deepEqual(extractArgs('github_create_issue', prompt('gh-create-missing-args')), {});
  assert.deepEqual(extractArgs('github_list_issues', prompt('gh-list')), {
    owner: 'acme',
    repo: 'shop',
    state: 'open',
  });
  assert.deepEqual(extractArgs('slack_post_message', prompt('slack-post')), {
    channel: 'releases',
    text: 'shop-web 1.4 is out',
  });
  assert.deepEqual(extractArgs('linear_create_issue', prompt('linear-create')), {
    title: 'retry webhook',
    team: 'Payments',
  });
  assert.deepEqual(extractArgs('notion_search', prompt('notion-search')), { query: 'onboarding guide' });
  assert.deepEqual(extractArgs('stripe_create_invoice', prompt('stripe-invoice')), {
    customer: 'cus_4491',
    amount: 1200,
    currency: 'usd',
  });
  assert.deepEqual(extractArgs('stripe_refund', prompt('stripe-refund')), { charge: 'ch_9912', amount: 500 });
  assert.deepEqual(extractArgs('calendar_create_event', prompt('calendar-create')), {
    title: 'launch sync',
    start: 'tomorrow 15:00 UTC',
  });
  assert.deepEqual(extractArgs('sentry_get_release_health', prompt('sentry-health')), { project: 'shop-web' });
  assert.deepEqual(extractArgs('k8s_rollout_restart', prompt('k8s-restart')), {
    deployment: 'api-gateway',
    namespace: 'prod',
  });
  assert.deepEqual(extractArgs('fs_read_file', prompt('fs-read')), { path: 'docs/runbook.md' });
});
