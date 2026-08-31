#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import {
  executeLightWorkspaceRequest,
  type LightWorkspaceExecutionRequest,
} from "./light-executor.js";

const chunks: Buffer[] = [];
for await (const chunk of stdin) chunks.push(Buffer.from(chunk));

try {
  const request = JSON.parse(
    Buffer.concat(chunks).toString("utf8"),
  ) as LightWorkspaceExecutionRequest;
  const result = await executeLightWorkspaceRequest(request);
  stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
