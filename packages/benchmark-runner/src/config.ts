import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ReasoningSelection } from "@blame/agent-runtime";
import type { BenchmarkConfig, BenchmarkPaths } from "./contracts.js";
import {
  assertHeadlessDevelopment,
  HeadlessConfigurationError,
} from "./dev-guard.js";

export type ParsedBenchmarkCommand = {
  config: BenchmarkConfig;
  paths: BenchmarkPaths;
};

const reasoningValues = new Set<ReasoningSelection>([
  "none",
  "enabled",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export async function parseBenchmarkCommand(
  argumentsList: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Promise<ParsedBenchmarkCommand> {
  assertHeadlessDevelopment(environment);
  if (argumentsList[0] !== "run") {
    throw new HeadlessConfigurationError("Expected the run command.");
  }
  const options = optionValues(argumentsList.slice(1));
  const instructionPath = requiredOption(options, "instruction-file");
  const instruction = await readFile(resolve(cwd, instructionPath), "utf8");
  return {
    config: benchmarkConfig(options, environment, cwd, instruction),
    paths: benchmarkPaths(options, cwd),
  };
}

function benchmarkConfig(
  options: Map<string, string>,
  environment: NodeJS.ProcessEnv,
  cwd: string,
  instruction: string,
): BenchmarkConfig {
  const reasoningEffort = reasoningValue(environment.BLAME_REASONING_EFFORT);
  return {
    apiUrl: requiredEnvironment(environment, "BLAME_API_URL"),
    isolatedEnvironment: isolatedEnvironmentValue(environment.BLAME_ISOLATED_ENVIRONMENT),
    apiToken: requiredEnvironment(environment, "BLAME_API_TOKEN"),
    credentialLabel: optionalEnvironment(environment, "BLAME_CREDENTIAL_LABEL"),
    harness: harnessValue(options.get("harness")),
    instruction,
    maxIterations: positiveInteger(
      options.get("max-iterations") ?? environment.BLAME_MAX_ITERATIONS,
      64,
      "max iterations",
    ),
    modelId: requiredEnvironment(environment, "BLAME_MODEL_ID"),
    projectMemoryFile: options.get("project-memory-file")
      ? resolve(cwd, options.get("project-memory-file")!)
      : undefined,
    providerId: requiredEnvironment(environment, "BLAME_PROVIDER_ID"),
    projectId:
      options.get("project-id")?.trim() ||
      (options.has("project-memory-file") ? "terminal-bench" : undefined),
    reasoningEffort,
    taskId: options.get("task-id")?.trim() || "terminal-bench",
    timeoutMs:
      positiveInteger(
        options.get("timeout-seconds") ?? environment.BLAME_TIMEOUT_SECONDS,
        900,
        "timeout seconds",
      ) * 1_000,
    workspaceRoot: resolve(cwd, options.get("workspace") ?? cwd),
  };
}

function harnessValue(value: string | undefined) {
  if (value === undefined || value === "blame") return "blame" as const;
  if (value === "cline") return "cline" as const;
  throw new HeadlessConfigurationError(`Invalid harness: ${value}.`);
}

function isolatedEnvironmentValue(value: string | undefined) {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new HeadlessConfigurationError("BLAME_ISOLATED_ENVIRONMENT must be true or false.");
}

function benchmarkPaths(options: Map<string, string>, cwd: string) {
  const defaultRoot = resolve(cwd, ".blame", "benchmarks");
  return {
    eventsPath: resolve(
      cwd,
      options.get("events") ?? `${defaultRoot}/events.jsonl`,
    ),
    resultPath: resolve(
      cwd,
      options.get("result") ?? `${defaultRoot}/result.json`,
    ),
  };
}

function optionValues(argumentsList: string[]) {
  const options = new Map<string, string>();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new HeadlessConfigurationError(
        `Invalid option near ${name ?? "end"}.`,
      );
    }
    options.set(name.slice(2), value);
  }
  return options;
}

function requiredOption(options: Map<string, string>, name: string) {
  const value = options.get(name)?.trim();
  if (!value) throw new HeadlessConfigurationError(`Missing --${name}.`);
  return value;
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new HeadlessConfigurationError(`Missing ${name}.`);
  return value;
}

function optionalEnvironment(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim() || undefined;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throw new HeadlessConfigurationError(`Invalid ${name}: ${value}.`);
}

function reasoningValue(value: string | undefined) {
  const normalized = value?.trim() as ReasoningSelection | undefined;
  if (!normalized) return undefined;
  if (reasoningValues.has(normalized)) return normalized;
  throw new HeadlessConfigurationError(`Invalid reasoning effort: ${value}.`);
}
