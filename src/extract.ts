// SPDX-License-Identifier: Apache-2.0

function repo(prompt: string): { owner?: string; repo?: string } {
  const match = prompt.match(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/);
  if (!match) return {};
  return { owner: match[1], repo: match[2] };
}

function titled(prompt: string): string | undefined {
  return prompt.match(/titled '([^']+)'/i)?.[1];
}

/** Pull required arguments out of a fixture prompt. Unknown tools get {}. */
export function extractArgs(tool: string, prompt: string): Record<string, unknown> {
  switch (tool) {
    case 'github_create_issue': {
      const names = repo(prompt);
      const title = titled(prompt);
      const label = prompt.match(/\badd the ([a-z0-9_-]+) label\b/i)?.[1];
      const args: Record<string, unknown> = {};
      if (names.owner) args.owner = names.owner;
      if (names.repo) args.repo = names.repo;
      if (title) args.title = title;
      if (label) args.labels = [label];
      return args;
    }
    case 'github_list_issues': {
      const names = repo(prompt);
      const args: Record<string, unknown> = {};
      if (names.owner) args.owner = names.owner;
      if (names.repo) args.repo = names.repo;
      if (/\bopen\b/i.test(prompt)) args.state = 'open';
      return args;
    }
    case 'slack_post_message': {
      const channel = prompt.match(/#([a-z0-9_-]+)/i)?.[1];
      const text = prompt.match(/saying '([^']+)'/i)?.[1];
      const args: Record<string, unknown> = {};
      if (channel) args.channel = channel;
      if (text) args.text = text;
      return args;
    }
    case 'linear_create_issue': {
      const title = titled(prompt);
      const team = prompt.match(/\bfor the ([A-Za-z0-9_-]+) team\b/)?.[1];
      const args: Record<string, unknown> = {};
      if (title) args.title = title;
      if (team) args.team = team;
      return args;
    }
    case 'notion_search': {
      const query = prompt.match(/search notion for the (.+?)\.?$/i)?.[1];
      return query ? { query } : {};
    }
    case 'stripe_create_invoice': {
      const customer = prompt.match(/\b(cus_[A-Za-z0-9]+)\b/)?.[1];
      const amount = prompt.match(/\bfor (\d+) usd\b/i)?.[1];
      const args: Record<string, unknown> = {};
      if (customer) args.customer = customer;
      if (amount) args.amount = Number(amount);
      if (/\busd\b/i.test(prompt)) args.currency = 'usd';
      return args;
    }
    case 'stripe_refund': {
      const charge = prompt.match(/\b(ch_[A-Za-z0-9]+)\b/)?.[1];
      const amount = prompt.match(/\bfor (\d+) usd\b/i)?.[1];
      const args: Record<string, unknown> = {};
      if (charge) args.charge = charge;
      if (amount) args.amount = Number(amount);
      return args;
    }
    case 'calendar_create_event': {
      const title = titled(prompt);
      const clock = prompt.match(/\btomorrow at (\d{2}:\d{2}) UTC\b/i)?.[1];
      const args: Record<string, unknown> = {};
      if (title) args.title = title;
      if (clock) args.start = `tomorrow ${clock} UTC`;
      return args;
    }
    case 'sentry_get_release_health': {
      const project = prompt.match(/\bfor the ([a-z0-9-]+) project\b/i)?.[1];
      return project ? { project } : {};
    }
    case 'fs_read_file': {
      const path = prompt.match(/\bfile (\S+)/)?.[1];
      return path ? { path } : {};
    }
    case 'k8s_rollout_restart': {
      const deployment = prompt.match(/\bdeployment ([a-z0-9-]+)\b/i)?.[1];
      const namespace = prompt.match(/\bnamespace ([a-z0-9-]+)\b/i)?.[1];
      const args: Record<string, unknown> = {};
      if (deployment) args.deployment = deployment;
      if (namespace) args.namespace = namespace;
      return args;
    }
    default:
      return {};
  }
}
