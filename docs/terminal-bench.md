# Terminal Bench headless runner

Blame can run as a development-only installed Harbor agent without Electron or the desktop renderer. Each trial starts one `BlameAgentRuntime` process inside the task container and writes its artifacts to `/logs/agent`.

## Build the local runner bundle

```bash
pnpm install
pnpm benchmark:agent:bundle
export BLAME_BENCHMARK_BUNDLE="$PWD/dist/blame-benchmark-runner.tgz"
```

The bundle contains the private benchmark runner and its production runtime dependencies. It is not referenced by `@blame/desktop` and is not included in desktop packages.

Build the bundle on Linux with the same CPU architecture as the Harbor workers. The lightweight bundle currently targets glibc-based x64 and arm64 task images.

## Configure Blame

```bash
export BLAME_API_URL="https://api.blame.so/api/v1"
export BLAME_API_TOKEN="..."
export BLAME_PROVIDER_ID="..."
export BLAME_MODEL_ID="..."
export BLAME_REASONING_EFFORT="high"
```

The configured Blame account must already contain the provider credential selected by `BLAME_PROVIDER_ID`. `BLAME_CREDENTIAL_LABEL` can select a non-default credential.

## Run with Harbor

Install Harbor in its own Python environment, then run a Terminal Bench dataset with the local adapter:

```bash
harbor run \
  -d "<terminal-bench-dataset>" \
  --agent tools.terminal_bench.blame_agent:BlameAgent \
  --model "<provider>/<model>"
```

`BLAME_MODEL_ID` takes precedence over the model passed to Harbor. Keep `--model` aligned with it so Harbor labels the result correctly.

The adapter uploads the prebuilt bundle, installs a pinned Node.js 22 runtime when required, and invokes `blame-headless` from the task working directory. It produces:

- `/logs/agent/events.jsonl`: redacted Blame agent events.
- `/logs/agent/result.json`: terminal status, duration, token usage, cost, and event counts.
- `/logs/agent/instruction.md`: the exact rendered benchmark instruction.

Harbor receives input, output, cache-token, cost, status, session, and tool-event metadata from `result.json`.

## Run one workspace directly

```bash
BLAME_HEADLESS_DEV=true \
NODE_ENV=development \
pnpm --filter @blame/benchmark-runner build

BLAME_HEADLESS_DEV=true \
NODE_ENV=development \
pnpm benchmark:agent -- run \
  --workspace /absolute/path/to/workspace \
  --instruction-file /absolute/path/to/instruction.md \
  --task-id local-smoke \
  --events /tmp/blame-events.jsonl \
  --result /tmp/blame-result.json
```

The direct run also requires `BLAME_API_URL`, `BLAME_API_TOKEN`, `BLAME_PROVIDER_ID`, and `BLAME_MODEL_ID`.

Exit code `0` means the agent reached a successful terminal event. Exit code `1` means a runtime or agent failure, `2` means invalid configuration, `124` means timeout, and `130` means cancellation.
