#!/usr/bin/env node
import { bootstrapRuntime } from "./bootstrap-runtime.js";
import { startEndpointGateway } from "./gateway/endpoint-gateway.js";
import { serveRunnerRequest } from "./protocol/runner-server.js";
import { watchChangeJournal } from "./workspace/change-journal.js";

void main();

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "bootstrap") {
      await bootstrapRuntime();
    } else if (command === "--request") {
      const response = await serveRunnerRequest(requiredArgument(args[0], "request path"));
      process.stdout.write(JSON.stringify(response));
      if (!response.ok) process.exitCode = 1;
    } else if (command === "gateway" && args[0] === "--config") {
      await startEndpointGateway(requiredArgument(args[1], "gateway config"));
    } else if (command === "watch-journal") {
      await watchChangeJournal();
    } else {
      throw new Error("Unsupported blame sandbox runner command.");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Runner failed."}\n`);
    process.exitCode = 1;
  }
}

function requiredArgument(value: string | undefined, name: string) {
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
