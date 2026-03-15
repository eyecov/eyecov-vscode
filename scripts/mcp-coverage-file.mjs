#!/usr/bin/env node
/**
 * One-off: call MCP coverage_file for src/coverage-runtime.ts and print the result.
 * Requires: npm run compile, npm run test:coverage (so coverage/lcov.info exists).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'out', 'mcp', 'server.js');

function send(proc, obj) {
  proc.stdin.write(JSON.stringify(obj) + '\n');
}

function readLine(rl) {
  return new Promise((resolve, reject) => {
    rl.once('line', (line) => resolve(line));
    rl.once('close', () => reject(new Error('stdout closed')));
  });
}

async function main() {
  const proc = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, COVFLUX_WORKSPACE_ROOTS: repoRoot },
  });

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  send(proc, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-coverage-file', version: '1.0' },
    },
  });
  const initLine = await readLine(rl);
  const initRes = JSON.parse(initLine);
  if (initRes.error) {
    console.error('initialize error:', initRes.error);
    proc.kill();
    process.exit(1);
  }

  send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });

  const toolCallId = 2;
  send(proc, {
    jsonrpc: '2.0',
    id: toolCallId,
    method: 'tools/call',
    params: {
      name: 'coverage_file',
      arguments: { query: 'src/coverage-runtime.ts' },
    },
  });

  let toolResult = null;
  while (true) {
    const line = await readLine(rl);
    const msg = JSON.parse(line);
    if (msg.method === 'roots/list' && msg.id != null) {
      send(proc, {
        jsonrpc: '2.0',
        id: msg.id,
        result: { roots: [{ uri: `file://${repoRoot}` }] },
      });
      continue;
    }
    if (msg.id === toolCallId) {
      toolResult = msg;
      break;
    }
    if (msg.error) {
      console.error('unexpected error:', msg.error);
      proc.kill();
      process.exit(1);
    }
  }

  proc.kill();

  if (toolResult.error) {
    console.error('tools/call error:', toolResult.error);
    process.exit(1);
  }

  const content = toolResult.result?.content?.[0]?.text ?? toolResult.result?.structuredContent;
  const data = typeof content === 'string' ? JSON.parse(content) : content;
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
