import json
import shlex
from pathlib import Path
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class BlameAgent(BaseInstalledAgent):
    @staticmethod
    @override
    def name() -> str:
        return "blame"

    @override
    def get_version_command(self) -> str | None:
        return "blame-headless --version"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        bundle = self._bundle_path()
        await self.ensure_system_dependencies(
            environment,
            ("ca_certificates", "coreutils", "curl", "nodejs", "tar", "xz"),
        )
        await environment.upload_file(bundle, "/tmp/blame-benchmark-runner.tgz")
        await self._install_node(environment)
        await self.exec_as_root(environment, command=self._install_runner_command())

    @override
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        instruction_path = self.logs_dir / "instruction.md"
        instruction_path.parent.mkdir(parents=True, exist_ok=True)
        instruction_path.write_text(instruction)
        remote_instruction = self.environment_logs_dir / "instruction.md"
        await environment.upload_file(instruction_path, remote_instruction.as_posix())
        await self.exec_as_agent(
            environment,
            command=self._run_command(remote_instruction.as_posix()),
            env=self._runtime_environment(),
        )

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        result = read_json_object(self.logs_dir / "result.json")
        usage = (result.get("usage") or {}).get("aggregateUsage") or {}
        fallback = not usage
        if fallback:
            usage = usage_from_events(self.logs_dir / "events.jsonl")
        if not usage and not result:
            return
        context.n_input_tokens = usage.get("totalInputTokens")
        context.n_output_tokens = usage.get("totalOutputTokens")
        context.n_cache_tokens = usage.get("totalCacheReadTokens")
        context.cost_usd = usage.get("totalCost")
        context.metadata = {
            "blame_status": result.get("status"),
            "blame_session_id": result.get("sessionId"),
            "blame_tool_events": result.get("toolEventCount"),
            "blame_usage_source": "events" if fallback else "result",
            "blame_usage_partial": fallback or result.get("status") != "succeeded",
        }

    def _bundle_path(self) -> Path:
        value = self._get_env("BLAME_BENCHMARK_BUNDLE")
        if not value:
            raise ValueError("BLAME_BENCHMARK_BUNDLE is required")
        path = Path(value).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        return path

    def _runtime_environment(self) -> dict[str, str]:
        required = [
            "BLAME_API_TOKEN",
            "BLAME_API_URL",
            "BLAME_PROVIDER_ID",
        ]
        values = {name: self._required_env(name) for name in required}
        values["BLAME_MODEL_ID"] = self._model_id()
        values["BLAME_HEADLESS_DEV"] = "true"
        values["BLAME_AGENT_PACKAGED"] = "false"
        values["NODE_ENV"] = "development"
        values["OTEL_SDK_DISABLED"] = "true"
        return {**values, **self._optional_runtime_environment()}

    def _optional_runtime_environment(self) -> dict[str, str]:
        names = [
            "BLAME_CREDENTIAL_LABEL",
            "BLAME_MAX_ITERATIONS",
            "BLAME_REASONING_EFFORT",
            "BLAME_TIMEOUT_SECONDS",
        ]
        return {name: value for name in names if (value := self._get_env(name))}

    def _required_env(self, name: str) -> str:
        value = self._get_env(name)
        if not value:
            raise ValueError(f"{name} is required")
        return value

    def _model_id(self) -> str:
        configured = self._get_env("BLAME_MODEL_ID")
        if configured:
            return configured
        if self.model_name:
            return self.model_name.split("/", maxsplit=1)[-1]
        raise ValueError("BLAME_MODEL_ID or a Harbor model is required")

    async def _install_node(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(environment, command=node_install_command())

    def _install_runner_command(self) -> str:
        return (
            "set -euo pipefail; "
            "rm -rf /installed-agent/blame; "
            "mkdir -p /installed-agent/blame; "
            "tar -xzf /tmp/blame-benchmark-runner.tgz -C /installed-agent/blame; "
            "chmod 755 /installed-agent/blame/dist/cli.js; "
            "ln -sf /installed-agent/blame/dist/cli.js /usr/local/bin/blame-headless; "
            "blame-headless --version"
        )

    def _run_command(self, instruction_path: str) -> str:
        logs = self.environment_logs_dir
        task_id = self.session_id or "terminal-bench"
        harness = self._get_env("BLAME_BENCHMARK_HARNESS") or "blame"
        if harness not in {"blame", "cline"}:
            raise ValueError(f"Unsupported benchmark harness: {harness}")
        return (
            "workspace=$(pwd -P); "
            "blame-headless run "
            f"--harness {harness} "
            '--workspace "$workspace" '
            f"--instruction-file {shlex.quote(instruction_path)} "
            f"--task-id {shlex.quote(task_id)} "
            f"--events {shlex.quote((logs / 'events.jsonl').as_posix())} "
            f"--result {shlex.quote((logs / 'result.json').as_posix())}"
        )


def read_json_object(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def usage_from_events(path: Path) -> dict:
    if not path.is_file():
        return {}
    usages = []
    for line in path.read_text().split("\n"):
        try:
            event = json.loads(line).get("event", {})
        except json.JSONDecodeError:
            continue
        if event.get("type") == "usage":
            usages.append((event.get("payload") or {}).get("usage") or {})
    if not usages:
        return {}
    fields = {"totalInputTokens": "inputTokens", "totalOutputTokens": "outputTokens",
              "totalCacheReadTokens": "cacheReadTokens", "totalCost": "cost"}
    return {total: observed_total(usages, field) for total, field in fields.items()}


def observed_total(usages: list[dict], field: str) -> int | float | None:
    values = [usage.get(field) for usage in usages]
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) for value in values):
        return None
    return sum(values)


def node_install_command() -> str:
    return (
        "set -euo pipefail; "
        "if node -e 'process.exit(Number(process.versions.node.split(`.`)[0]) >= 22 ? 0 : 1)' "
        "2>/dev/null; then exit 0; fi; "
        "case $(uname -m) in "
        "x86_64) arch=x64; sha=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307 ;; "
        "aarch64|arm64) arch=arm64; sha=fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8 ;; "
        "*) echo unsupported architecture >&2; exit 1 ;; esac; "
        "archive=/tmp/node-v22.23.2-linux-$arch.tar.xz; "
        "curl -fsSL https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-$arch.tar.xz -o $archive; "
        "echo \"$sha  $archive\" | sha256sum -c -; "
        "rm -rf /opt/blame-node; mkdir -p /opt/blame-node; "
        "tar -xJf $archive -C /opt/blame-node --strip-components=1; "
        "ln -sf /opt/blame-node/bin/node /usr/local/bin/node; "
        "ln -sf /opt/blame-node/bin/npm /usr/local/bin/npm"
    )
