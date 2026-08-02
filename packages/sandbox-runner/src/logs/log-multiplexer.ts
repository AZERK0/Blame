import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PreviewLogEvent, PreviewSessionState } from "@blame/preview-runtime";
import { runtimePaths } from "../runtime-paths.js";

export async function processLogEvents(input: {
  sessionId: string;
  serviceIds: string[];
  messages?: Array<{ serviceId: string; message: string }>;
  cursor?: string;
  serviceId?: string;
  state: PreviewSessionState;
}): Promise<PreviewLogEvent[]> {
  const after = safeCursor(input.cursor);
  const ids = input.serviceId ? [input.serviceId] : input.serviceIds;
  const values = input.messages ?? await fileLogMessages(ids);
  return values.slice(after, after + 1000).map((value, index) => ({
    sessionId: input.sessionId,
    sequence: after + index + 1,
    timestamp: new Date().toISOString(),
    state: input.state,
    serviceId: value.serviceId,
    stream: "stdout",
    message: redact(value.message),
  }));
}

async function fileLogMessages(ids: string[]) {
  const values: Array<{ serviceId: string; message: string }> = [];
  for (const serviceId of ids) {
    try {
      const lines = (await readFile(join(runtimePaths.logs, `${safeId(serviceId)}.log`), "utf8"))
        .slice(-4 * 1024 * 1024)
        .split("\n")
        .filter(Boolean);
      values.push(...lines.map((message) => ({ serviceId, message })));
    } catch {}
  }
  return values;
}

export function redact(message: string) {
  return message
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/(authorization|token|secret|password|api[_-]?key)[=: ]+[^\s]+/gi, "$1=[redacted]")
    .slice(0, 16_384);
}

function safeCursor(value: string | undefined) {
  const cursor = Number(value ?? 0);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}
