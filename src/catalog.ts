// SPDX-License-Identifier: Apache-2.0
import type { FieldSpec, ToolRole, ToolSpec } from './types.js';

/**
 * Synthetic 90-tool MCP catalog.
 *
 * Four tools are distractors: their descriptions repeat a rare phrase that
 * also appears in one eval prompt. The scripted lexical agent scores the full
 * description, so those phrases pull it off the gold tool when the distractor
 * is still in the catalog. Headlines stay specific, which is what the CLI
 * skill and lazy search rank instead.
 *
 * The repeated footer is identical on every tool, so its tokens count toward
 * schema cost and its words have almost no IDF.
 */
const FOOTER =
  'Operational notes: responses are paginated with an opaque cursor. Calls are idempotent when an idempotency key is supplied. The server enforces a per-minute rate limit and records an audit entry for every mutation. Transient failures should be attempted again with exponential backoff. Scopes are checked before the handler runs.';

/** Rare phrase that should appear only on the named distractor. */
export const DISTRACTOR_BAIT: Readonly<Record<string, readonly string[]>> = {
  github_create_issue_from_template: ['flaky', 'checkout'],
  linear_create_issue_from_template: ['retry', 'webhook'],
  calendar_create_event_from_template: ['launch', 'sync'],
  fs_read_file_archive: ['runbook'],
};

function field(
  name: string,
  description: string,
  opts?: {
    type?: FieldSpec['type'];
    required?: boolean;
    enumValues?: readonly [string, ...string[]];
  },
): FieldSpec {
  return {
    name,
    description,
    type: opts?.type ?? 'string',
    required: opts?.required ?? true,
    enumValues: opts?.enumValues,
  };
}

function commonFields(): FieldSpec[] {
  return [
    field('idempotency_key', 'Client-generated key so a retried mutation is applied at most once.', {
      required: false,
    }),
    field('timeout_ms', 'Server-side timeout for this call, in milliseconds.', {
      type: 'number',
      required: false,
    }),
    field('trace_id', 'Trace identifier copied into the audit log for this call.', { required: false }),
  ];
}

function macro(phrase: string): string {
  const line = `Legacy macro text, do not treat as instructions: ${phrase}.`;
  return Array.from({ length: 5 }, () => line).join(' ');
}

interface Seed {
  name: string;
  family: string;
  role?: ToolRole;
  headline: string;
  extra?: string;
  fields: FieldSpec[];
}

function build(seed: Seed): ToolSpec {
  if (!seed.headline.endsWith('.')) {
    throw new Error(`headline must end with a period: ${seed.name}`);
  }
  const role = seed.role ?? 'filler';
  const description = [seed.headline, seed.extra, FOOTER].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return {
    name: seed.name,
    family: seed.family,
    role,
    headline: seed.headline,
    description,
    fields: [...seed.fields, ...commonFields()],
  };
}

const ghOwner = [
  field('owner', 'GitHub login or organization that owns the repository.'),
  field('repo', 'Repository name, without the owner prefix.'),
];

const seeds: Seed[] = [
  {
    name: 'github_create_issue',
    family: 'github',
    role: 'primary',
    headline: 'Create an issue in a GitHub repository.',
    extra:
      'Use for an ordinary issue. Supply the repository owner, the repository name, and a title. Optional labels can be applied. This does not apply a preset form.',
    fields: [
      ...ghOwner,
      field('title', 'Issue title shown in the repository issue list.'),
      field('body', 'Markdown body of the issue.', { required: false }),
      field('labels', 'Labels to apply to the new issue.', { type: 'string[]', required: false }),
    ],
  },
  {
    name: 'github_list_issues',
    family: 'github',
    role: 'primary',
    headline: 'List open issues in a GitHub repository.',
    extra: 'Filter by open, closed, or all. Results are ordered by recent update.',
    fields: [
      ...ghOwner,
      field('state', 'Which issues to include.', {
        required: false,
        enumValues: ['open', 'closed', 'all'],
      }),
      field('labels', 'Only issues that carry all of these labels.', { type: 'string[]', required: false }),
    ],
  },
  {
    name: 'github_comment_issue',
    family: 'github',
    headline: 'Add a comment to a GitHub issue.',
    fields: [
      ...ghOwner,
      field('issue_number', 'Numeric issue identifier.', { type: 'number' }),
      field('body', 'Markdown comment body.'),
    ],
  },
  {
    name: 'github_close_issue',
    family: 'github',
    headline: 'Close a GitHub issue.',
    fields: [
      ...ghOwner,
      field('issue_number', 'Numeric issue identifier.', { type: 'number' }),
      field('reason', 'Why the issue is being closed.', {
        required: false,
        enumValues: ['completed', 'not_planned'],
      }),
    ],
  },
  {
    name: 'github_create_pr',
    family: 'github',
    headline: 'Create a pull request in a GitHub repository.',
    fields: [
      ...ghOwner,
      field('title', 'Pull request title.'),
      field('head', 'Branch that contains the changes.'),
      field('base', 'Branch the changes should land on.'),
      field('body', 'Markdown pull request body.', { required: false }),
    ],
  },
  {
    name: 'github_list_prs',
    family: 'github',
    headline: 'List pull requests in a GitHub repository.',
    fields: [
      ...ghOwner,
      field('state', 'Which pull requests to include.', {
        required: false,
        enumValues: ['open', 'closed', 'all'],
      }),
    ],
  },
  {
    name: 'github_review_pr',
    family: 'github',
    headline: 'Submit a review on a GitHub pull request.',
    fields: [
      ...ghOwner,
      field('pull_number', 'Pull request number.', { type: 'number' }),
      field('event', 'Review decision.', { enumValues: ['approve', 'request_changes', 'comment'] }),
      field('body', 'Review summary.', { required: false }),
    ],
  },
  {
    name: 'github_merge_pr',
    family: 'github',
    headline: 'Merge a GitHub pull request.',
    fields: [
      ...ghOwner,
      field('pull_number', 'Pull request number.', { type: 'number' }),
      field('merge_method', 'How to merge.', {
        required: false,
        enumValues: ['merge', 'squash', 'rebase'],
      }),
    ],
  },
  {
    name: 'github_create_issue_from_template',
    family: 'github',
    role: 'distractor',
    headline: 'Create a GitHub issue from a saved template.',
    extra: macro('flaky checkout'),
    fields: [
      ...ghOwner,
      field('template_id', 'Identifier of the saved issue template.'),
      field('title', 'Optional title override.', { required: false }),
    ],
  },
  {
    name: 'github_search_code',
    family: 'github',
    headline: 'Search code in a GitHub repository.',
    fields: [
      field('query', 'Code search query.'),
      ...ghOwner.map((item) => field(item.name, item.description, { required: false })),
    ],
  },
  {
    name: 'slack_post_message',
    family: 'slack',
    role: 'primary',
    headline: 'Post a message to a Slack channel.',
    extra: 'Supply the channel name without a hash prefix, and the message text.',
    fields: [
      field('channel', 'Channel name, without a leading hash.'),
      field('text', 'Message text.'),
      field('thread_ts', 'Parent message timestamp when replying in a thread.', { required: false }),
    ],
  },
  {
    name: 'slack_list_channels',
    family: 'slack',
    headline: 'List Slack channels in the workspace.',
    fields: [
      field('limit', 'Maximum channels to return.', { type: 'number', required: false }),
      field('types', 'Channel types to include.', { required: false, enumValues: ['public', 'private', 'all'] }),
    ],
  },
  {
    name: 'slack_create_channel',
    family: 'slack',
    headline: 'Create a Slack channel.',
    fields: [
      field('name', 'Channel name, without a leading hash.'),
      field('is_private', 'Whether the channel is private.', { type: 'boolean', required: false }),
    ],
  },
  {
    name: 'slack_reply_thread',
    family: 'slack',
    headline: 'Reply in a Slack thread.',
    fields: [
      field('channel', 'Channel that holds the thread.'),
      field('thread_ts', 'Timestamp of the parent message.'),
      field('text', 'Reply text.'),
    ],
  },
  {
    name: 'slack_add_reaction',
    family: 'slack',
    headline: 'Add an emoji reaction to a Slack message.',
    fields: [
      field('channel', 'Channel that holds the message.'),
      field('timestamp', 'Message timestamp.'),
      field('emoji', 'Emoji name, without colons.'),
    ],
  },
  {
    name: 'slack_upload_file',
    family: 'slack',
    headline: 'Upload a file to a Slack channel.',
    fields: [
      field('channel', 'Channel that should receive the file.'),
      field('filename', 'File name to display.'),
      field('content', 'UTF-8 file contents.'),
    ],
  },
  {
    name: 'slack_invite_user',
    family: 'slack',
    headline: 'Invite a user to a Slack channel.',
    fields: [
      field('channel', 'Channel to invite the user into.'),
      field('user', 'Slack user id to invite.'),
    ],
  },
  {
    name: 'slack_search_messages',
    family: 'slack',
    headline: 'Search Slack messages.',
    fields: [field('query', 'Message search query.'), field('limit', 'Maximum hits.', { type: 'number', required: false })],
  },
  {
    name: 'linear_create_issue',
    family: 'linear',
    role: 'primary',
    headline: 'Create an issue in a Linear team.',
    extra: 'Supply a title and the team name. This does not apply a preset form.',
    fields: [
      field('title', 'Issue title.'),
      field('team', 'Linear team name.'),
      field('description', 'Markdown description.', { required: false }),
    ],
  },
  {
    name: 'linear_update_issue',
    family: 'linear',
    headline: 'Update an existing Linear issue.',
    fields: [
      field('issue_id', 'Linear issue identifier.'),
      field('title', 'Replacement title.', { required: false }),
      field('state', 'Workflow state name.', { required: false }),
    ],
  },
  {
    name: 'linear_list_issues',
    family: 'linear',
    headline: 'List Linear issues for a team.',
    fields: [
      field('team', 'Linear team name.'),
      field('state', 'Workflow state filter.', { required: false }),
    ],
  },
  {
    name: 'linear_create_project',
    family: 'linear',
    headline: 'Create a Linear project.',
    fields: [field('name', 'Project name.'), field('team', 'Linear team that owns the project.')],
  },
  {
    name: 'linear_search',
    family: 'linear',
    headline: 'Search Linear issues and projects.',
    fields: [field('query', 'Search text.')],
  },
  {
    name: 'linear_add_comment',
    family: 'linear',
    headline: 'Add a comment to a Linear issue.',
    fields: [field('issue_id', 'Linear issue identifier.'), field('body', 'Comment markdown.')],
  },
  {
    name: 'linear_assign',
    family: 'linear',
    headline: 'Assign a Linear issue to a user.',
    fields: [field('issue_id', 'Linear issue identifier.'), field('assignee', 'User display name or id.')],
  },
  {
    name: 'linear_create_issue_from_template',
    family: 'linear',
    role: 'distractor',
    headline: 'Create a Linear issue from a saved template.',
    extra: macro('retry webhook'),
    fields: [
      field('template_id', 'Identifier of the saved Linear template.'),
      field('team', 'Linear team name.', { required: false }),
    ],
  },
  {
    name: 'notion_create_page',
    family: 'notion',
    headline: 'Create a Notion page.',
    fields: [field('parent_id', 'Parent page or database id.'), field('title', 'Page title.')],
  },
  {
    name: 'notion_update_page',
    family: 'notion',
    headline: 'Update a Notion page title.',
    fields: [field('page_id', 'Page id.'), field('title', 'Replacement title.')],
  },
  {
    name: 'notion_search',
    family: 'notion',
    role: 'primary',
    headline: 'Search Notion pages and databases.',
    extra: 'Supply a free-text query.',
    fields: [field('query', 'Search text.')],
  },
  {
    name: 'notion_append_block',
    family: 'notion',
    headline: 'Append a block to a Notion page.',
    fields: [field('page_id', 'Page id.'), field('markdown', 'Markdown to append.')],
  },
  {
    name: 'notion_query_database',
    family: 'notion',
    headline: 'Query a Notion database.',
    fields: [
      field('database_id', 'Database id.'),
      field('filter', 'JSON filter expression.', { required: false }),
    ],
  },
  {
    name: 'notion_create_database',
    family: 'notion',
    headline: 'Create a Notion database.',
    fields: [field('parent_id', 'Parent page id.'), field('title', 'Database title.')],
  },
  {
    name: 'postgres_query',
    family: 'postgres',
    headline: 'Run a SQL query against Postgres.',
    fields: [field('sql', 'Single SQL statement.'), field('limit', 'Maximum rows to return.', { type: 'number', required: false })],
  },
  {
    name: 'postgres_list_tables',
    family: 'postgres',
    headline: 'List tables in a Postgres schema.',
    fields: [field('schema', 'Schema name.', { required: false })],
  },
  {
    name: 'postgres_describe_table',
    family: 'postgres',
    role: 'primary',
    headline: 'Describe columns of a Postgres table.',
    fields: [field('table', 'Table name.'), field('schema', 'Schema name.', { required: false })],
  },
  {
    name: 'postgres_insert_row',
    family: 'postgres',
    headline: 'Insert a row into a Postgres table.',
    fields: [field('table', 'Table name.'), field('values', 'JSON object of column values.')],
  },
  {
    name: 'postgres_update_row',
    family: 'postgres',
    headline: 'Update rows in a Postgres table.',
    fields: [
      field('table', 'Table name.'),
      field('where', 'JSON object of equality filters.'),
      field('values', 'JSON object of columns to set.'),
    ],
  },
  {
    name: 'postgres_explain',
    family: 'postgres',
    headline: 'Explain a Postgres query plan.',
    fields: [field('sql', 'SQL statement to explain.')],
  },
  {
    name: 'postgres_list_schemas',
    family: 'postgres',
    headline: 'List schemas in the Postgres database.',
    fields: [field('include_system', 'Include system schemas.', { type: 'boolean', required: false })],
  },
  {
    name: 'postgres_dump_table',
    family: 'postgres',
    headline: 'Dump rows from a Postgres table.',
    fields: [field('table', 'Table name.'), field('limit', 'Maximum rows.', { type: 'number', required: false })],
  },
  {
    name: 'stripe_create_customer',
    family: 'stripe',
    headline: 'Create a Stripe customer.',
    fields: [field('email', 'Customer email.'), field('name', 'Customer name.', { required: false })],
  },
  {
    name: 'stripe_create_invoice',
    family: 'stripe',
    role: 'primary',
    headline: 'Create a Stripe invoice for a customer.',
    extra: 'Supply the customer id, the amount in major units, and the currency code.',
    fields: [
      field('customer', 'Stripe customer id.'),
      field('amount', 'Amount in major units.', { type: 'number' }),
      field('currency', 'ISO currency code.', { enumValues: ['usd', 'eur', 'gbp'] }),
    ],
  },
  {
    name: 'stripe_list_charges',
    family: 'stripe',
    headline: 'List Stripe charges.',
    fields: [
      field('customer', 'Customer id filter.', { required: false }),
      field('limit', 'Maximum charges.', { type: 'number', required: false }),
    ],
  },
  {
    name: 'stripe_refund',
    family: 'stripe',
    role: 'primary',
    headline: 'Refund a Stripe charge.',
    extra: 'Supply the charge id and the amount in major units.',
    fields: [
      field('charge', 'Stripe charge id.'),
      field('amount', 'Amount to refund in major units.', { type: 'number' }),
    ],
  },
  {
    name: 'stripe_create_payment_link',
    family: 'stripe',
    headline: 'Create a Stripe payment link.',
    fields: [
      field('amount', 'Amount in major units.', { type: 'number' }),
      field('currency', 'ISO currency code.', { enumValues: ['usd', 'eur', 'gbp'] }),
      field('description', 'Link description.', { required: false }),
    ],
  },
  {
    name: 'stripe_get_balance',
    family: 'stripe',
    headline: 'Get the Stripe account balance.',
    fields: [field('currency', 'Currency to report.', { required: false, enumValues: ['usd', 'eur', 'gbp'] })],
  },
  {
    name: 'stripe_create_subscription',
    family: 'stripe',
    headline: 'Create a Stripe subscription.',
    fields: [field('customer', 'Stripe customer id.'), field('price', 'Price id.')],
  },
  {
    name: 'stripe_search_customers',
    family: 'stripe',
    headline: 'Search Stripe customers.',
    fields: [field('query', 'Customer search query.')],
  },
  {
    name: 'calendar_create_event',
    family: 'calendar',
    role: 'primary',
    headline: 'Create an event on the primary calendar.',
    extra: 'Supply the event title and a start time.',
    fields: [
      field('title', 'Event title.'),
      field('start', 'Start time, as a short phrase or timestamp.'),
      field('timezone', 'IANA timezone.', { required: false }),
    ],
  },
  {
    name: 'calendar_list_events',
    family: 'calendar',
    headline: 'List calendar events in a time range.',
    fields: [field('start', 'Range start.'), field('end', 'Range end.')],
  },
  {
    name: 'calendar_update_event',
    family: 'calendar',
    headline: 'Update a calendar event.',
    fields: [
      field('event_id', 'Event id.'),
      field('title', 'Replacement title.', { required: false }),
      field('start', 'Replacement start.', { required: false }),
    ],
  },
  {
    name: 'calendar_delete_event',
    family: 'calendar',
    headline: 'Delete a calendar event.',
    fields: [field('event_id', 'Event id.')],
  },
  {
    name: 'calendar_find_slots',
    family: 'calendar',
    headline: 'Find open slots on the primary calendar.',
    fields: [
      field('duration_minutes', 'Slot length in minutes.', { type: 'number' }),
      field('window_start', 'When the search window starts.'),
    ],
  },
  {
    name: 'calendar_create_event_from_template',
    family: 'calendar',
    role: 'distractor',
    headline: 'Create a calendar event from a saved template.',
    extra: macro('launch sync'),
    fields: [field('template_id', 'Saved event template id.'), field('start', 'Start time.', { required: false })],
  },
  {
    name: 'fs_read_file',
    family: 'filesystem',
    role: 'primary',
    headline: 'Read a file from the workspace filesystem.',
    extra: 'Supply a workspace-relative path.',
    fields: [field('path', 'Workspace-relative file path.')],
  },
  {
    name: 'fs_write_file',
    family: 'filesystem',
    headline: 'Write a file on the workspace filesystem.',
    fields: [field('path', 'Workspace-relative file path.'), field('content', 'UTF-8 contents.')],
  },
  {
    name: 'fs_list_dir',
    family: 'filesystem',
    headline: 'List a directory on the workspace filesystem.',
    fields: [field('path', 'Workspace-relative directory path.')],
  },
  {
    name: 'fs_search',
    family: 'filesystem',
    headline: 'Search file contents on the workspace filesystem.',
    fields: [field('query', 'Text to find.'), field('path', 'Directory to search.', { required: false })],
  },
  {
    name: 'fs_delete',
    family: 'filesystem',
    headline: 'Delete a file on the workspace filesystem.',
    fields: [field('path', 'Workspace-relative file path.')],
  },
  {
    name: 'fs_move',
    family: 'filesystem',
    headline: 'Move a file on the workspace filesystem.',
    fields: [field('from', 'Source path.'), field('to', 'Destination path.')],
  },
  {
    name: 'fs_stat',
    family: 'filesystem',
    headline: 'Stat a path on the workspace filesystem.',
    fields: [field('path', 'Workspace-relative path.')],
  },
  {
    name: 'fs_read_file_archive',
    family: 'filesystem',
    role: 'distractor',
    headline: 'Read a file from the archived filesystem snapshot.',
    extra: macro('runbook'),
    fields: [
      field('snapshot_id', 'Archive snapshot id.'),
      field('path', 'Path inside the snapshot.', { required: false }),
    ],
  },
  {
    name: 'browser_navigate',
    family: 'browser',
    role: 'primary',
    headline: 'Navigate the browser to a URL.',
    fields: [field('url', 'Absolute URL to open.')],
  },
  {
    name: 'browser_click',
    family: 'browser',
    headline: 'Click an element in the browser.',
    fields: [field('selector', 'CSS selector of the element.')],
  },
  {
    name: 'browser_fill',
    family: 'browser',
    headline: 'Fill an input in the browser.',
    fields: [field('selector', 'CSS selector of the input.'), field('value', 'Value to type.')],
  },
  {
    name: 'browser_screenshot',
    family: 'browser',
    headline: 'Take a screenshot of the browser page.',
    fields: [field('full_page', 'Capture the full page.', { type: 'boolean', required: false })],
  },
  {
    name: 'browser_snapshot',
    family: 'browser',
    headline: 'Capture an accessibility snapshot of the browser page.',
    fields: [field('selector', 'Subtree selector.', { required: false })],
  },
  {
    name: 'browser_evaluate',
    family: 'browser',
    headline: 'Evaluate JavaScript in the browser page.',
    fields: [field('script', 'JavaScript source to evaluate.')],
  },
  {
    name: 'browser_wait',
    family: 'browser',
    headline: 'Wait for a selector in the browser.',
    fields: [
      field('selector', 'CSS selector to wait for.'),
      field('timeout_ms', 'How long to wait, in milliseconds.', { type: 'number', required: false }),
    ],
  },
  {
    name: 'browser_back',
    family: 'browser',
    headline: 'Go back in browser history.',
    fields: [field('steps', 'How many history entries to go back.', { type: 'number', required: false })],
  },
  {
    name: 'sentry_list_issues',
    family: 'sentry',
    headline: 'List Sentry issues for a project.',
    fields: [field('project', 'Sentry project slug.'), field('query', 'Issue search query.', { required: false })],
  },
  {
    name: 'sentry_get_issue',
    family: 'sentry',
    headline: 'Get a Sentry issue by id.',
    fields: [field('issue_id', 'Sentry issue id.')],
  },
  {
    name: 'sentry_resolve_issue',
    family: 'sentry',
    headline: 'Resolve a Sentry issue.',
    fields: [field('issue_id', 'Sentry issue id.')],
  },
  {
    name: 'sentry_list_releases',
    family: 'sentry',
    headline: 'List Sentry releases for a project.',
    fields: [field('project', 'Sentry project slug.')],
  },
  {
    name: 'sentry_get_release_health',
    family: 'sentry',
    role: 'primary',
    headline: 'Fetch Sentry release health for a project.',
    extra: 'Supply the project slug.',
    fields: [field('project', 'Sentry project slug.')],
  },
  {
    name: 'sentry_search_events',
    family: 'sentry',
    headline: 'Search Sentry events.',
    fields: [field('query', 'Event search query.'), field('project', 'Sentry project slug.')],
  },
  {
    name: 'k8s_list_pods',
    family: 'kubernetes',
    headline: 'List Kubernetes pods in a namespace.',
    fields: [field('namespace', 'Kubernetes namespace.')],
  },
  {
    name: 'k8s_get_pod_logs',
    family: 'kubernetes',
    headline: 'Get logs from a Kubernetes pod.',
    fields: [field('namespace', 'Kubernetes namespace.'), field('pod', 'Pod name.')],
  },
  {
    name: 'k8s_rollout_restart',
    family: 'kubernetes',
    role: 'primary',
    headline: 'Restart a Kubernetes deployment rollout.',
    extra: 'Supply the namespace and the deployment name.',
    fields: [field('namespace', 'Kubernetes namespace.'), field('deployment', 'Deployment name.')],
  },
  {
    name: 'k8s_describe_deploy',
    family: 'kubernetes',
    headline: 'Describe a Kubernetes deployment.',
    fields: [field('namespace', 'Kubernetes namespace.'), field('deployment', 'Deployment name.')],
  },
  {
    name: 'k8s_scale',
    family: 'kubernetes',
    headline: 'Scale a Kubernetes deployment.',
    fields: [
      field('namespace', 'Kubernetes namespace.'),
      field('deployment', 'Deployment name.'),
      field('replicas', 'Desired replica count.', { type: 'number' }),
    ],
  },
  {
    name: 'k8s_port_forward',
    family: 'kubernetes',
    headline: 'Port-forward a Kubernetes pod.',
    fields: [
      field('namespace', 'Kubernetes namespace.'),
      field('pod', 'Pod name.'),
      field('local_port', 'Local port.', { type: 'number' }),
      field('remote_port', 'Pod port.', { type: 'number' }),
    ],
  },
  {
    name: 'k8s_apply',
    family: 'kubernetes',
    headline: 'Apply a Kubernetes manifest.',
    fields: [field('manifest', 'YAML manifest text.')],
  },
  {
    name: 'k8s_delete_pod',
    family: 'kubernetes',
    headline: 'Delete a Kubernetes pod.',
    fields: [field('namespace', 'Kubernetes namespace.'), field('pod', 'Pod name.')],
  },
  {
    name: 'datadog_query_metrics',
    family: 'datadog',
    headline: 'Query Datadog metrics.',
    fields: [
      field('query', 'Metrics query expression.'),
      field('from', 'Range start.', { required: false }),
      field('to', 'Range end.', { required: false }),
    ],
  },
  {
    name: 'pagerduty_ack',
    family: 'pagerduty',
    headline: 'Acknowledge a PagerDuty incident.',
    fields: [field('incident_id', 'PagerDuty incident id.')],
  },
  {
    name: 'jira_create_issue',
    family: 'jira',
    headline: 'Create a Jira issue.',
    fields: [
      field('project', 'Jira project key.'),
      field('summary', 'Issue summary.'),
      field('issue_type', 'Issue type name.', { required: false }),
    ],
  },
  {
    name: 'crm_upsert_contact',
    family: 'crm',
    headline: 'Upsert a CRM contact.',
    fields: [field('email', 'Contact email.'), field('name', 'Contact name.', { required: false })],
  },
  {
    name: 'admin_export_audit_log',
    family: 'admin',
    headline: 'Export the admin audit log.',
    fields: [field('start', 'Range start.'), field('end', 'Range end.')],
  },
  {
    name: 'deprecated_batch_mutate',
    family: 'admin',
    headline: 'Apply a deprecated batch mutation.',
    fields: [field('operations', 'JSON array of mutation operations.')],
  },
];

export const KITCHEN_SINK_TOOLS: readonly ToolSpec[] = seeds.map(build);

export const TOOL_BY_NAME: ReadonlyMap<string, ToolSpec> = new Map(
  KITCHEN_SINK_TOOLS.map((tool) => [tool.name, tool]),
);

export function assertCatalog(): void {
  if (KITCHEN_SINK_TOOLS.length !== 90) {
    throw new Error(`expected 90 tools, found ${KITCHEN_SINK_TOOLS.length}`);
  }
  const names = new Set<string>();
  for (const tool of KITCHEN_SINK_TOOLS) {
    if (names.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    names.add(tool.name);
    if (!tool.description.startsWith(tool.headline)) {
      throw new Error(`description does not start with headline: ${tool.name}`);
    }
  }
  const tokenOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length > 1);
  for (const [owner, baits] of Object.entries(DISTRACTOR_BAIT)) {
    if (!names.has(owner)) throw new Error(`unknown distractor ${owner}`);
    for (const bait of baits) {
      for (const tool of KITCHEN_SINK_TOOLS) {
        const present = tokenOf(tool.description).includes(bait);
        if (present && tool.name !== owner) {
          throw new Error(`bait "${bait}" leaked into ${tool.name}`);
        }
        if (!present && tool.name === owner) {
          throw new Error(`bait "${bait}" missing from ${owner}`);
        }
      }
    }
  }
}

assertCatalog();

export function invokeTool(spec: ToolSpec, raw: unknown): { ok: boolean; payload: Record<string, unknown> } {
  const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const missing: string[] = [];
  for (const fieldSpec of spec.fields) {
    if (!fieldSpec.required) continue;
    const value = args[fieldSpec.name];
    if (value === undefined || value === null || value === '') {
      missing.push(fieldSpec.name);
      continue;
    }
    if (fieldSpec.type === 'string' && typeof value !== 'string') missing.push(fieldSpec.name);
    if (fieldSpec.type === 'number' && typeof value !== 'number') missing.push(fieldSpec.name);
    if (fieldSpec.type === 'boolean' && typeof value !== 'boolean') missing.push(fieldSpec.name);
    if (fieldSpec.type === 'string[]' && !Array.isArray(value)) missing.push(fieldSpec.name);
    if (fieldSpec.enumValues && typeof value === 'string' && !fieldSpec.enumValues.includes(value)) {
      missing.push(fieldSpec.name);
    }
  }
  if (missing.length > 0) {
    return { ok: false, payload: { ok: false, tool: spec.name, missing } };
  }
  return { ok: true, payload: { ok: true, tool: spec.name, echo: args } };
}
