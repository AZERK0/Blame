import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { RuntimeAgentClient } from "./runtime-agent.ts";

type Request = {
  id: number;
  method: string;
  params: Record<string, unknown>;
};

class FakeAgentProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  requests: Request[] = [];
  private readonly handle: (
    request: Request,
    process: FakeAgentProcess,
  ) => void;

  constructor(handle: (request: Request, process: FakeAgentProcess) => void) {
    super();
    this.handle = handle;
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          const request = JSON.parse(line) as Request;
          this.requests.push(request);
          this.handle(request, this);
        }
        callback();
      },
    });
  }

  kill() {
    this.exitCode = 1;
    this.emit("exit", 1);
    return true;
  }
}

test("runtime agent client sends exec requests over one WSL process", async () => {
  const processes: FakeAgentProcess[] = [];
  const spawnProcess = fakeSpawn(processes, (request, process) => {
    process.stdout.write(
      `${JSON.stringify({
        id: request.id,
        ok: true,
        result: { stderr: "", stdout: "done" },
      })}\n`,
    );
  });
  const client = new RuntimeAgentClient({
    env: { PATH: "/bin" },
    platform: "win32",
    spawnProcess,
  });

  const result = await client.exec({
    args: ["status"],
    command: "git",
    timeoutMs: 1_000,
  });

  assert.equal(result.stdout, "done");
  assert.equal(processes.length, 1);
  assert.equal(processes[0].requests[0].method, "exec");
  assert.equal(processes[0].requests[0].params.command, "git");
  assert.equal(processes[0].requests[0].params.timeoutMs, 1_000);
});

test("runtime agent client rejects failed exec responses with output", async () => {
  const spawnProcess = fakeSpawn([], (request, process) => {
    process.stdout.write(
      `${JSON.stringify({
        error: { message: "failed", stderr: "bad", stdout: "partial" },
        id: request.id,
        ok: false,
      })}\n`,
    );
  });
  const client = new RuntimeAgentClient({ platform: "darwin", spawnProcess });

  await assert.rejects(
    client.exec({ args: [], command: "false" }),
    (error: unknown) => {
      assert.equal((error as Error).message, "failed\npartial\nbad");
      assert.equal((error as { stderr?: string }).stderr, "bad");
      assert.equal((error as { stdout?: string }).stdout, "partial");
      return true;
    },
  );
});

test("runtime agent client proxies spawn output and exit events", async () => {
  const spawnProcess = fakeSpawn([], (request, process) => {
    setImmediate(() => {
      process.stdout.write(
        `${JSON.stringify({
          id: request.id,
          ok: true,
          result: { processId: "process-1" },
        })}\n`,
      );
      process.stdout.write(
        `${JSON.stringify({
          data: "hello\n",
          event: "spawn",
          processId: "process-1",
          type: "stdout",
        })}\n`,
      );
      process.stdout.write(
        `${JSON.stringify({
          code: 0,
          event: "spawn",
          processId: "process-1",
          type: "exit",
        })}\n`,
      );
    });
  });
  const client = new RuntimeAgentClient({ platform: "win32", spawnProcess });

  const child = client.spawn({ args: ["hello"], command: "echo" });
  const outputPromise = onceData(child);
  const exitPromise = onceExit(child);
  const output = await outputPromise;
  const exitCode = await exitPromise;

  assert.equal(output, "hello\n");
  assert.equal(exitCode, 0);
});

test("runtime agent client sends a compact command environment", async () => {
  const processes: FakeAgentProcess[] = [];
  const spawnProcess = fakeSpawn(processes, (request, process) => {
    process.stdout.write(
      `${JSON.stringify({
        id: request.id,
        ok: true,
        result: { stderr: "", stdout: "done" },
      })}\n`,
    );
  });
  const client = new RuntimeAgentClient({ platform: "darwin", spawnProcess });

  await client.exec({
    args: [],
    command: "true",
    env: {
      BLAME_PROJECT_ROOT: "/worktree",
      COMPOSE_PROJECT_NAME: "blame_test",
      npm_config_user_agent: "x".repeat(100_000),
      PATH: "/bin",
    },
  });

  const env = processes[0].requests[0].params.env as Record<string, string>;
  assert.equal(env.BLAME_PROJECT_ROOT, "/worktree");
  assert.equal(env.COMPOSE_PROJECT_NAME, "blame_test");
  assert.equal(env.PATH, "/bin");
  assert.equal(env.npm_config_user_agent, undefined);
});

test("runtime agent client requests Cline hub ensure", async () => {
  const processes: FakeAgentProcess[] = [];
  const spawnProcess = fakeSpawn(processes, (request, process) => {
    process.stdout.write(
      `${JSON.stringify({
        id: request.id,
        ok: true,
        result: {
          authToken: "secret",
          status: "ready",
          url: "ws://127.0.0.1:25463/hub",
        },
      })}\n`,
    );
  });
  const client = new RuntimeAgentClient({ platform: "darwin", spawnProcess });

  const result = await client.clineHubEnsure();

  assert.equal(processes[0].requests[0].method, "clineHubEnsure");
  assert.equal(result.url, "ws://127.0.0.1:25463/hub");
  assert.equal(result.authToken, "secret");
});

test("runtime agent client batches existing file reads", async () => {
  const processes: FakeAgentProcess[] = [];
  const spawnProcess = fakeSpawn(processes, (request, process) => {
    process.stdout.write(
      `${JSON.stringify({
        id: request.id,
        ok: true,
        result: { files: { "/worktree/package.json": "{}" } },
      })}\n`,
    );
  });
  const client = new RuntimeAgentClient({ platform: "darwin", spawnProcess });

  const result = await client.readExistingFiles(["/worktree/package.json"]);

  assert.equal(processes[0].requests[0].method, "readExistingFiles");
  assert.deepEqual(processes[0].requests[0].params.paths, [
    "/worktree/package.json",
  ]);
  assert.equal(result.files["/worktree/package.json"], "{}");
});

test("runtime agent client treats stream kill as best effort", async () => {
  const spawnProcess = fakeSpawn([], (request, process) => {
    if (request.method === "spawn") {
      process.stdout.write(
        `${JSON.stringify({
          id: request.id,
          ok: true,
          result: { processId: "process-1" },
        })}\n`,
      );
    }
    if (request.method === "kill") {
      process.stdout.write(
        `${JSON.stringify({
          error: { message: "kill failed" },
          id: request.id,
          ok: false,
        })}\n`,
      );
    }
  });
  const client = new RuntimeAgentClient({ platform: "darwin", spawnProcess });

  const child = client.spawn({ args: [], command: "sleep" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(child.kill(), true);
});

function fakeSpawn(
  processes: FakeAgentProcess[],
  handle: (request: Request, process: FakeAgentProcess) => void,
) {
  return ((command: string, args: string[]) => {
    const process = new FakeAgentProcess(handle);
    processes.push(process);
    assert.equal(typeof command, "string");
    assert.ok(Array.isArray(args));
    return process as unknown as ChildProcessWithoutNullStreams;
  }) as typeof spawn;
}

function onceData(child: ChildProcessWithoutNullStreams) {
  return new Promise<string>((resolve) => {
    child.stdout.once("data", (data: Buffer) => resolve(data.toString()));
  });
}

function onceExit(child: ChildProcessWithoutNullStreams) {
  return new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
}
