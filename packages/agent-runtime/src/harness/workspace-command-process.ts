import { spawn, type ChildProcess } from "node:child_process";
import { execa } from "execa";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { workspaceCommandEnvironment } from "./workspace-command-environment.js";

type CommandOptions = {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maximumOutputBytes?: number;
};

export type WorkspaceCommandResult = {
  all: string;
  exitCode?: number;
  failed: boolean;
  interruption?: "cancelled" | "timed_out" | "output_limit";
};

export function executeWorkspaceCommand(
  executable: string,
  args: string[],
  options: CommandOptions,
): Promise<WorkspaceCommandResult> {
  options.signal?.throwIfAborted();
  const child = spawnWorkspaceProcess(executable, args, options.cwd);
  return new CommandExecution(child, options).run();
}

function spawnWorkspaceProcess(executable: string, args: string[], cwd: string) {
  const options = {
    cwd,
    env: workspaceCommandEnvironment(process.env, executable),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
  if (process.platform !== "win32") return spawn(executable, args, options);
  const child = execa(executable, args, {
    ...options,
    buffer: false,
    extendEnv: false,
    reject: false,
  });
  void child.catch(() => undefined);
  return child;
}

class CommandExecution {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private finished = false;
  private exitCode?: number;
  private interruption?: WorkspaceCommandResult["interruption"];
  private error?: string;
  private timer?: NodeJS.Timeout;
  private drainTimer?: NodeJS.Timeout;
  private resolve!: (result: WorkspaceCommandResult) => void;
  private readonly cancel = () => this.interrupt("cancelled");

  constructor(
    private readonly child: ChildProcess,
    private readonly options: CommandOptions,
  ) {}

  run() {
    const completion = new Promise<WorkspaceCommandResult>((resolve) => {
      this.resolve = resolve;
    });
    this.capture(this.child.stdout);
    this.capture(this.child.stderr);
    this.child.once("error", (error) => this.spawnError(error));
    this.child.once("exit", (code, signal) => this.exited(code, signal));
    this.child.once("close", () => this.finish());
    this.timer = setTimeout(
      () => this.interrupt("timed_out"),
      this.options.timeoutMs ?? 120_000,
    );
    this.options.signal?.addEventListener("abort", this.cancel, { once: true });
    if (this.options.signal?.aborted) this.cancel();
    return completion;
  }

  private capture(stream: Readable | null) {
    if (!stream) return;
    const decoder = new StringDecoder("utf8");
    stream.on("data", (chunk: Buffer) => this.append(Buffer.from(decoder.write(chunk))));
    stream.once("end", () => this.append(Buffer.from(decoder.end())));
    stream.once("error", (error) => {
      terminateCommand(this.child);
      this.spawnError(error);
    });
  }

  private append(chunk: Buffer) {
    if (this.finished || this.interruption) return;
    const limit = this.options.maximumOutputBytes ?? 512 * 1024;
    const remaining = limit - this.bytes;
    const retained = chunk.subarray(0, remaining);
    this.chunks.push(retained);
    this.bytes += retained.length;
    if (chunk.length > remaining) this.interrupt("output_limit");
  }

  private exited(code: number | null, signal: NodeJS.Signals | null) {
    if (this.finished) return;
    this.exitCode = code ?? undefined;
    if (signal) this.error = `Command terminated by ${signal}.`;
    this.scheduleDrain();
  }

  private spawnError(error: Error) {
    this.error = error.message;
    this.finish();
  }

  private interrupt(reason: NonNullable<WorkspaceCommandResult["interruption"]>) {
    if (this.finished || this.interruption) return;
    this.interruption = reason;
    terminateCommand(this.child);
    this.scheduleDrain();
  }

  private scheduleDrain() {
    if (!this.drainTimer)
      this.drainTimer = setTimeout(() => this.finish(), 100);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    clearTimeout(this.drainTimer);
    this.options.signal?.removeEventListener("abort", this.cancel);
    this.child.stdout?.destroy();
    this.child.stderr?.destroy();
    this.child.unref();
    this.resolve({
      all: this.output(),
      exitCode: this.exitCode,
      failed: this.exitCode !== 0 || !!this.interruption || !!this.error,
      ...(this.interruption ? { interruption: this.interruption } : {}),
    });
  }

  private output() {
    const diagnostic = this.interruption
      ? interruptionDiagnostic(this.interruption, this.options.timeoutMs)
      : this.error;
    return [Buffer.concat(this.chunks).toString("utf8"), diagnostic]
      .filter(Boolean)
      .join("\n");
  }
}

function terminateCommand(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    cleanup.once("error", () => child.kill());
    cleanup.unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL");
  }
}

function interruptionDiagnostic(
  reason: NonNullable<WorkspaceCommandResult["interruption"]>,
  timeoutMs = 120_000,
) {
  if (reason === "cancelled") return "Command cancelled before completion.";
  if (reason === "timed_out") return `Command timed out after ${timeoutMs} ms.`;
  return "Command exceeded the captured output limit.";
}
