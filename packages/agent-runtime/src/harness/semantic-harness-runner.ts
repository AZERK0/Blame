#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import {
  executeCanonicalSemanticWorkspaceRequest,
  type SemanticWorkspaceExecutionRequest,
} from "./semantic-executor.js";

const chunks: Buffer[] = [];
for await (const chunk of stdin) chunks.push(Buffer.from(chunk));

try {
  const request = JSON.parse(
    Buffer.concat(chunks).toString("utf8"),
  ) as SemanticWorkspaceExecutionRequest;
  const result = await executeCanonicalSemanticWorkspaceRequest(request);
  stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
