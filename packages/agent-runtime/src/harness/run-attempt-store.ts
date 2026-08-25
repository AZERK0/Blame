import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { sha256 } from "./protocol.js";

const activeRunAttempts = new Map<string, number>();

export type RunAttemptStatus =
  | "running"
  | "passed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "runtime_error";

export type RunAttempt = {
  completed_at?: string;
  environment: string;
  error?: string;
  revision: string;
  run_attempt_ref: string;
  run_ref?: string;
  schema_version: "2.0";
  started_at: string;
  status: RunAttemptStatus;
  task: unknown;
  tool_call_id: string;
};

export class RunAttemptStore {
  private readonly directory: string;

  constructor(workspaceRoot: string) {
    this.directory = join(workspaceRoot, ".blame", "harness", "run-attempts");
  }

  async start(input: {
    environment: string;
    identity: string;
    revision: string;
    task: unknown;
    toolCallId: string;
  }) {
    await this.recoverIncomplete(input.identity);
    const runAttemptRef = `run-attempt://${sha256(input.identity)}`;
    const existing = await this.readOptional(runAttemptRef);
    if (existing) {
      if (existing.status === "running") activateAttempt(runAttemptRef);
      return existing;
    }
    const attempt: RunAttempt = {
      schema_version: "2.0",
      run_attempt_ref: runAttemptRef,
      tool_call_id: input.toolCallId,
      revision: input.revision,
      task: input.task,
      environment: input.environment,
      status: "running",
      started_at: new Date().toISOString(),
    };
    await this.write(attempt);
    activateAttempt(runAttemptRef);
    return attempt;
  }

  async finish(
    attempt: RunAttempt,
    status: Exclude<RunAttemptStatus, "running">,
    details: { error?: string; runRef?: string } = {},
  ) {
    const terminal: RunAttempt = {
      ...attempt,
      status,
      completed_at: new Date().toISOString(),
      ...(details.runRef ? { run_ref: details.runRef } : {}),
      ...(details.error ? { error: details.error.slice(0, 2_000) } : {}),
    };
    await this.write(terminal);
    deactivateAttempt(attempt.run_attempt_ref);
    return terminal;
  }

  private async recoverIncomplete(activeIdentity: string) {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
    const activeRef = `run-attempt://${sha256(activeIdentity)}`;
    for (const name of names.filter((value) => value.endsWith(".json"))) {
      const attempt = await this.readPath(join(this.directory, name));
      if (
        attempt.status !== "running" ||
        attempt.run_attempt_ref === activeRef ||
        activeRunAttempts.has(attempt.run_attempt_ref)
      )
        continue;
      await this.finish(attempt, "runtime_error", {
        error:
          "The runtime stopped before this task produced a terminal result.",
      });
    }
  }

  private async readOptional(ref: string) {
    try {
      return await this.readPath(this.path(ref));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  private async readPath(path: string): Promise<RunAttempt> {
    const value = JSON.parse(await readFile(path, "utf8")) as RunAttempt;
    if (value.schema_version !== "2.0")
      throw new Error("Run attempt schema is unsupported.");
    return value;
  }

  private async write(attempt: RunAttempt) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFileAtomic(
      this.path(attempt.run_attempt_ref),
      JSON.stringify(attempt),
      {
        fsync: true,
        mode: 0o600,
      },
    );
  }

  private path(ref: string) {
    const digest = ref.startsWith("run-attempt://") ? ref.slice(14) : "";
    if (!/^[a-f0-9]{64}$/u.test(digest))
      throw new Error("Run attempt ref is invalid.");
    return join(this.directory, `${digest}.json`);
  }
}

function activateAttempt(ref: string) {
  activeRunAttempts.set(ref, (activeRunAttempts.get(ref) ?? 0) + 1);
}

function deactivateAttempt(ref: string) {
  const count = activeRunAttempts.get(ref) ?? 0;
  if (count <= 1) activeRunAttempts.delete(ref);
  else activeRunAttempts.set(ref, count - 1);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
