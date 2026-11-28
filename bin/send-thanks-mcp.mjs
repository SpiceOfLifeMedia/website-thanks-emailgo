#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createSendThanksMcpServer } from '../src/lib/send-thanks-mcp.mjs';

if (!process.env.EMAILGO_API_KEY?.trim()) {
  process.stderr.write('Set EMAILGO_API_KEY in the MCP server process environment.\n');
  process.exit(1);
}

serveStdio(() => createSendThanksMcpServer(), {
  onerror: () => process.stderr.write('Email, thanks MCP protocol error.\n'),
});
