#!/usr/bin/env node
/**
 * Verify the EyeCov MCP server runs and responds to initialize + tools/call.
 * Spawns out/mcp/server.js, drives it via stdio (newline-delimited JSON-RPC),
 * and exits 0 only if coverage_file returns a valid response.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const serverPath = path.join(repoRoot, "out", "mcp", "server.js");
const ansiTextLogo =
  "\u001b[48;2;0;0;0m\u001b[38;2;90;12;163m \u25ae\u001b[38;2;124;58;237m\u25ae\u001b[38;2;159;103;255m\u25ae\u001b[38;2;255;255;255meyecov \u001b[0m";

function send(obj) {
  const line = JSON.stringify(obj) + "\n";
  proc.stdin.write(line);
}

function readLine() {
  return new Promise((resolve, reject) => {
    rl.once("line", (line) => resolve(line));
    rl.once("close", () => reject(new Error("stdout closed")));
  });
}

let proc;
let rl;

async function main() {
  console.error(ansiTextLogo);

  proc = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "inherit"],
  });

  rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  const initReq = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "verify-mcp", version: "1.0" },
    },
  };
  send(initReq);
  const initLine = await readLine();
  const initRes = JSON.parse(initLine);
  if (initRes.error) {
    console.error("initialize error:", initRes.error);
    process.exit(1);
  }
  if (!initRes.result || !initRes.result.capabilities) {
    console.error("initialize missing result.capabilities:", initRes);
    process.exit(1);
  }

  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const toolCallId = 2;
  send({
    jsonrpc: "2.0",
    id: toolCallId,
    method: "tools/call",
    params: {
      name: "coverage_file",
      arguments: { query: "GetEmployeeAction.php" },
    },
  });

  let toolResult = null;
  while (true) {
    const line = await readLine();
    const msg = JSON.parse(line);
    if (msg.method === "roots/list" && msg.id != null) {
      send({ jsonrpc: "2.0", id: msg.id, result: { roots: [] } });
      continue;
    }
    if (msg.id === toolCallId) {
      toolResult = msg;
      break;
    }
    if (msg.error) {
      console.error("unexpected error response:", msg);
      process.exit(1);
    }
  }

  if (toolResult.error) {
    console.error("tools/call error:", toolResult.error);
    process.exit(1);
  }

  const result = toolResult.result;
  if (!result || typeof result.content === "undefined") {
    console.error("tools/call missing result:", toolResult);
    process.exit(1);
  }

  const structured = result.structuredContent ?? result;
  if (
    typeof structured.query !== "string" ||
    typeof structured.resolved !== "boolean" ||
    typeof structured.matchCount !== "number"
  ) {
    console.error(
      "tools/call result missing query/resolved/matchCount:",
      structured,
    );
    process.exit(1);
  }

  console.log(
    "MCP server OK: coverage_file returned query=%s resolved=%s matchCount=%s",
    structured.query,
    structured.resolved,
    structured.matchCount,
  );
  proc.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  if (proc) proc.kill();
  process.exit(1);
});
