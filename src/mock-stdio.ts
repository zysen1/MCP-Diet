// SPDX-License-Identifier: Apache-2.0
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createKitchenSinkServer } from './servers.js';

const raw = process.env.MCP_DIET_ALLOWLIST;
const allow =
  raw && raw.trim().length > 0
    ? new Set(
        raw
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0),
      )
    : undefined;

serveStdio(() => createKitchenSinkServer(allow ? { allow } : undefined));
