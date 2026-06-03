import { createHash } from "node:crypto"
import { isAbsolute, relative, resolve } from "node:path"
import { platform, release } from "node:os"

import type {
  BasicLogger,
  ConfiguredTelemetryHandle,
  CoreCompactionConfig,
  ITelemetryService,
  CoreSessionConfig,
  SessionUsageSummary,
} from "@cline/sdk"

export type ProductionConfig = {
  compactionEnabled?: boolean
  compactionMaxInputTokens?: number
  compactionPreserveRecentTokens?: number
  compactionReserveTokens?: number
  compactionStrategy?: "agentic" | "basic"
  compactionThresholdRatio?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  maxParallelToolCalls?: number
  maxSessionCostUsd?: number
  maxTotalTokens?: number
}

export type ProductionSessionContext = {
  durationMs?: number
  finishReason?: string
  maxIterations?: number
  mode?: string
  modelId?: string
  providerId?: string
  sessionId?: string
  status?: string
  storyId?: string | number
}

type TelemetryHandle = Pick<ConfiguredTelemetryHandle, "dispose" | "flush" | "telemetry">

const secretKeys = [
  "access",
  "apiKey",
  "authorization",
  "headers",
  "oauthCredentials",
  "refresh",
  "token",
]

const allowedLogKeys = new Set([
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
  "durationMs",
  "errorType",
  "finishReason",
  "inputTokens",
  "maxIterations",
  "maxParallelToolCalls",
  "mode",
  "modelId",
  "outputTokens",
  "promptHash",
  "promptLength",
  "providerId",
  "rawTotalTokens",
  "sessionId",
  "sessionTotalTokens",
  "status",
  "storyId",
  "success",
  "toolName",
  "totalCost",
  "totalTokens",
])

export function loadProductionConfig(env: NodeJS.ProcessEnv = process.env): ProductionConfig {
  return {
    compactionEnabled: booleanValue(env.BLAME_AGENT_COMPACTION_ENABLED, true),
    compactionMaxInputTokens: positiveNumber(env.BLAME_AGENT_COMPACTION_MAX_INPUT_TOKENS),
    compactionPreserveRecentTokens: positiveNumber(env.BLAME_AGENT_COMPACTION_PRESERVE_RECENT_TOKENS),
    compactionReserveTokens: positiveNumber(env.BLAME_AGENT_COMPACTION_RESERVE_TOKENS),
    compactionStrategy: compactionStrategy(env.BLAME_AGENT_COMPACTION_STRATEGY),
    compactionThresholdRatio: ratioNumber(env.BLAME_AGENT_COMPACTION_THRESHOLD_RATIO),
    maxInputTokens: positiveNumber(env.BLAME_AGENT_MAX_INPUT_TOKENS),
    maxOutputTokens: positiveNumber(env.BLAME_AGENT_MAX_OUTPUT_TOKENS),
    maxParallelToolCalls: positiveNumber(env.BLAME_AGENT_MAX_PARALLEL_TOOL_CALLS, 8),
    maxSessionCostUsd: positiveNumber(env.BLAME_AGENT_MAX_SESSION_COST_USD),
    maxTotalTokens: positiveNumber(env.BLAME_AGENT_MAX_TOTAL_TOKENS),
  }
}

export async function createProductionTelemetry(
  logger: BasicLogger,
  env: NodeJS.ProcessEnv = process.env
): Promise<TelemetryHandle | undefined> {
  if (!telemetryEnabled(env)) return undefined
  const sdk = await import("@cline/sdk")
  return sdk.createConfiguredTelemetryHandle({
    enabled: true,
    logger,
    metadata: telemetryMetadata(),
    name: "blame-agent-runtime",
    serviceName: "blame-agent-runtime",
  })
}

export function createProductionLogger(): BasicLogger {
  return {
    debug: (_message: string, metadata?: unknown) =>
      console.debug("[blame-agent]", "sdk debug", safeLogPayload(metadata)),
    log: (_message: string, metadata?: unknown) =>
      console.info("[blame-agent]", "sdk log", safeLogPayload(metadata)),
    error: (_message: string, metadata?: unknown) =>
      console.error("[blame-agent]", "sdk error", safeLogPayload(metadata)),
  }
}

export function promptMetadata(prompt: string) {
  return {
    promptHash: createHash("sha256").update(prompt).digest("hex"),
    promptLength: prompt.length,
  }
}

export function appendProductionConfig<T extends CoreSessionConfig>(config: T): T {
  const configWithLimits = config as T & {
    maxConsecutiveMistakes?: number
    maxParallelToolCalls?: number
  }
  return {
    ...config,
    execution: {
      ...config.execution,
      loopDetection: config.execution?.loopDetection ?? { hardThreshold: 5, softThreshold: 3 },
      maxConsecutiveMistakes: config.execution?.maxConsecutiveMistakes ?? 3,
    },
    maxConsecutiveMistakes: configWithLimits.maxConsecutiveMistakes ?? 3,
    maxParallelToolCalls: configWithLimits.maxParallelToolCalls ?? loadProductionConfig().maxParallelToolCalls,
  }
}

export function blameCompactionConfig(config: ProductionConfig): CoreCompactionConfig {
  return {
    enabled: config.compactionEnabled ?? true,
    ...(config.compactionMaxInputTokens ? { maxInputTokens: config.compactionMaxInputTokens } : {}),
    ...(config.compactionPreserveRecentTokens
      ? { preserveRecentTokens: config.compactionPreserveRecentTokens }
      : {}),
    ...(config.compactionReserveTokens ? { reserveTokens: config.compactionReserveTokens } : {}),
    strategy: config.compactionStrategy ?? "basic",
    ...(config.compactionThresholdRatio ? { thresholdRatio: config.compactionThresholdRatio } : {}),
  }
}

export function assertWorkspacePath(path: string, workspaceRoot: string, label: string) {
  const resolvedPath = resolve(path)
  const resolvedWorkspace = resolve(workspaceRoot)
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path.`)
  if (!isAbsolute(workspaceRoot)) throw new Error("workspaceRoot must be an absolute path.")
  if (!isPathInside(resolvedPath, resolvedWorkspace)) {
    throw new Error(`${label} must stay inside workspaceRoot.`)
  }
}

export function assertRepositoryPath(path: string, label: string) {
  if (!isAbsolute(path)) throw new Error(`${label} must be an absolute path.`)
}

export function summarizeUsage(summary: SessionUsageSummary | undefined) {
  const usage = summary?.aggregateUsage ?? summary?.usage
  if (!usage) return {}
  const sessionTotalTokens = totalTokens(usage)
  return {
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: usage.totalCost,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    rawTotalTokens: rawTotalTokens(usage),
    sessionTotalTokens,
    totalCost: usage.totalCost,
    totalTokens: sessionTotalTokens,
  }
}

export function shouldAbortForUsage(summary: SessionUsageSummary | undefined, config: ProductionConfig) {
  const usage = summary?.aggregateUsage ?? summary?.usage
  if (!usage) return false
  if (config.maxTotalTokens !== undefined && totalTokens(usage) > config.maxTotalTokens) return true
  if (config.maxSessionCostUsd !== undefined && usage.totalCost > config.maxSessionCostUsd) return true
  if (config.maxInputTokens !== undefined && usage.inputTokens > config.maxInputTokens) return true
  if (config.maxOutputTokens !== undefined && usage.outputTokens > config.maxOutputTokens) return true
  return false
}

export function usageLimitMessage(summary: SessionUsageSummary | undefined, config: ProductionConfig) {
  const usage = summary?.aggregateUsage ?? summary?.usage
  if (!usage) return "Usage limit exceeded."
  if (config.maxTotalTokens !== undefined && totalTokens(usage) > config.maxTotalTokens) {
    return `Total token limit exceeded (${config.maxTotalTokens})`
  }
  if (config.maxSessionCostUsd !== undefined && usage.totalCost > config.maxSessionCostUsd) {
    return `Cost limit exceeded ($${config.maxSessionCostUsd.toFixed(2)})`
  }
  if (config.maxInputTokens !== undefined && usage.inputTokens > config.maxInputTokens) {
    return `Input token limit exceeded (${config.maxInputTokens})`
  }
  if (config.maxOutputTokens !== undefined && usage.outputTokens > config.maxOutputTokens) {
    return `Output token limit exceeded (${config.maxOutputTokens})`
  }
  return "Usage limit exceeded."
}

export function recordUsageTelemetry(
  telemetry: ITelemetryService | undefined,
  summary: SessionUsageSummary | undefined,
  context: ProductionSessionContext
) {
  const usage = summarizeUsage(summary)
  if (!Object.keys(usage).length) return
  telemetry?.recordCounter("blame.agent.tokens.input", numberValue(usage.inputTokens), context)
  telemetry?.recordCounter("blame.agent.tokens.output", numberValue(usage.outputTokens), context)
  telemetry?.recordGauge("blame.agent.cost.usd", numberValue(usage.costUsd), context)
}

export function safeLogPayload(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowedLogKeys.has(key) && !secretKeys.includes(key))
      .map(([key, field]) => [key, safeLogValue(field)])
  )
}

function telemetryEnabled(env: NodeJS.ProcessEnv) {
  if (env.OTEL_TELEMETRY_ENABLED === "true") return true
  if (env.OTEL_SDK_DISABLED === "true") return false
  return Boolean(
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      env.OTEL_LOGS_EXPORTER ||
      env.OTEL_METRICS_EXPORTER
  )
}

function telemetryMetadata() {
  return {
    cline_type: "desktop",
    extension_version: "0.0.0",
    os_type: platform(),
    os_version: release(),
    platform: "blame",
    platform_version: process.version,
  }
}

function safeLogValue(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") return value.slice(0, 255)
  return undefined
}

function positiveNumber(value: string | undefined, fallback?: number) {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function ratioNumber(value: string | undefined, fallback?: number) {
  const parsed = positiveNumber(value)
  if (parsed === undefined) return fallback
  return parsed > 0 && parsed < 1 ? parsed : fallback
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  return value !== "false"
}

function compactionStrategy(value: string | undefined) {
  return value === "agentic" ? "agentic" : "basic"
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : 0
}

function totalTokens(usage: {
  cacheReadTokens: number
  cacheWriteTokens: number
  inputTokens: number
  outputTokens: number
}) {
  return usage.inputTokens + usage.outputTokens
}

function rawTotalTokens(usage: {
  cacheReadTokens: number
  cacheWriteTokens: number
  inputTokens: number
  outputTokens: number
}) {
  return totalTokens(usage) + usage.cacheReadTokens + usage.cacheWriteTokens
}

function isPathInside(path: string, parent: string) {
  const pathRelativeToParent = relative(parent, path)
  return (
    pathRelativeToParent === "" ||
    (!pathRelativeToParent.startsWith("..") && !isAbsolute(pathRelativeToParent))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}
