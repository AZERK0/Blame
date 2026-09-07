#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import {
  executeLightWorkspaceRequest,
  type LightWorkspaceExecutionRequest,
} from "./light-executor.js";

const chunks: Buffer[] = [];
for await (const chunk of stdin) chunks.push(Buffer.from(chunk));

const controller = new AbortController();
const cancel = () => controller.abort(new Error("Semantic workspace operation cancelled."));
process.once("SIGTERM", cancel);
process.once("SIGINT", cancel);

try {
  const request = JSON.parse(
    Buffer.concat(chunks).toString("utf8"),
  ) as LightWorkspaceExecutionRequest;
  const result = await executeLightWorkspaceRequest(request, controller.signal);
  controller.signal.throwIfAborted();
  stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  process.removeListener("SIGTERM", cancel);
  process.removeListener("SIGINT", cancel);
}
