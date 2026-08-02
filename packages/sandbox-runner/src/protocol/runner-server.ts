import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type { RunnerRequest, RunnerResponse } from "./runner-contract.js";
import { RunnerApplication } from "../runner-application.js";

const requestRoot = "/run/blame/control/requests/";
const fencingTokenPath = "/var/lib/blame/runtime/fencing-token";

export async function serveRunnerRequest(requestPath: string): Promise<RunnerResponse> {
  try {
    const path = validatedRequestPath(requestPath);
    const content = await readFile(path, "utf8");
    await rm(path, { force: true });
    const request = parseRunnerRequest(JSON.parse(content));
    await acceptFencingToken(request.fencingToken);
    return { ok: true, result: await new RunnerApplication().dispatch(request) };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: runnerErrorCode(error),
        message: error instanceof Error ? error.message.slice(0, 500) : "Runner request failed.",
      },
    };
  }
}

function validatedRequestPath(value: string) {
  if (!value.startsWith(requestRoot) || !/^\/run\/blame\/control\/requests\/[a-f0-9-]+\.json$/.test(value)) {
    throw runnerError("RUNNER_ACCESS_DENIED", "Runner request path is invalid.");
  }
  return value;
}

function parseRunnerRequest(value: unknown): RunnerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw runnerError("RUNNER_PROTOCOL_INVALID", "Runner request must be an object.");
  }
  const request = value as Record<string, unknown>;
  if (!Number.isSafeInteger(request.fencingToken) || Number(request.fencingToken) < 1) {
    throw runnerError("RUNNER_PROTOCOL_INVALID", "Runner fencing token is invalid.");
  }
  const operations = new Set([
    "handshake",
    "resume-host",
    "prepare-engine",
    "start-services",
    "stop-services",
    "inspect",
    "endpoints",
    "logs",
    "source-import",
    "source-export-prepare",
    "source-export-upload",
    "source-export-ack",
    "exec",
  ]);
  if (typeof request.operation !== "string" || !operations.has(request.operation)) {
    throw runnerError("RUNNER_PROTOCOL_INVALID", "Runner operation is unsupported.");
  }
  return request as RunnerRequest;
}

async function acceptFencingToken(value: number) {
  const current = await readFile(fencingTokenPath, "utf8")
    .then((token) => Number(token))
    .catch(() => 0);
  assertFreshFencingToken(current, value);
  if (value === current) return;
  const temporary = `${fencingTokenPath}.${process.pid}.tmp`;
  await writeFile(temporary, String(value), { mode: 0o600, flush: true });
  await rename(temporary, fencingTokenPath);
}

export function assertFreshFencingToken(current: number, incoming: number) {
  if (incoming < current) {
    throw runnerError("STALE_FENCING_TOKEN", "Runner request belongs to a stale control worker.");
  }
}

export function runnerError(code: string, message: string) {
  return Object.assign(new Error(message), { runnerCode: code });
}

function runnerErrorCode(error: unknown) {
  const code = (error as { runnerCode?: unknown })?.runnerCode;
  return typeof code === "string" ? code : "RUNNER_INTERNAL";
}
