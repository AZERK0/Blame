import { createHash } from "node:crypto";
import type { Attributes, AttributeValue } from "@opentelemetry/api";
import {
  ATTR_BLAME_AGENT_ROLE,
  ATTR_BLAME_AGENT_STRATEGY,
  ATTR_BLAME_EXECUTION_KIND,
  ATTR_BLAME_EXECUTION_RECOVERED,
  ATTR_BLAME_EXECUTION_STATUS,
  ATTR_BLAME_INTERVENTION_TYPE,
  ATTR_BLAME_MULTI_AGENT_ENABLED,
  ATTR_BLAME_MULTI_AGENT_USED,
  ATTR_BLAME_OPERATION_NAME,
  ATTR_BLAME_OPERATION_STATUS,
  ATTR_BLAME_PROVIDER_AUTH_TYPE,
  ATTR_BLAME_REPOSITORY_LANGUAGE,
  ATTR_BLAME_REPOSITORY_SIZE_BUCKET,
  ATTR_BLAME_RUNTIME_DEPENDENCY_NAME,
  ATTR_BLAME_RUNTIME_DEPENDENCY_STATUS,
  ATTR_BLAME_RUNTIME_INITIAL_STATE,
  ATTR_BLAME_RUNTIME_NAME,
  ATTR_BLAME_RUNTIME_OPERATION,
  ATTR_BLAME_RUNTIME_PHASE,
  ATTR_BLAME_RUNTIME_PROBE_NAME,
  ATTR_BLAME_RUNTIME_REPORT_STAGE,
  ATTR_BLAME_RUNTIME_STATE,
  ATTR_BLAME_TASK_COMPLEXITY_BUCKET,
  ATTR_BLAME_TOOL_CATEGORY,
  ATTR_BLAME_TOOL_NAME,
  ATTR_BLAME_TEST_STATUS,
  ATTR_ERROR_TYPE,
  ATTR_EXCEPTION_TYPE,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_TOOL_NAME,
} from "./semantic-attributes.js";

const maximumAttributeCount = 64;
const maximumStringLength = 1_024;
const blockedKeyPattern =
  /(?:^|[._-])(?:api[._-]?key|authorization|command|content|cookie|credential|env|password|prompt|secret|stderr|stdout|system[._-]?instructions|input[._-]?messages|output[._-]?messages|tool[._-]?call[._-]?(?:arguments|result)|access[._-]?token|refresh[._-]?token)(?:$|[._-])/i;
const blockedValueReplacements: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]"],
  [
    /\b(?:api[_-]?key|access[_-]?token|authorization|password|refresh[_-]?token|secret|token)\s*[=:]\s*[^\s,;]+/gi,
    "[REDACTED]",
  ],
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
];
export const allowedMetricAttributeKeys = [
  ATTR_BLAME_AGENT_ROLE,
  ATTR_BLAME_AGENT_STRATEGY,
  ATTR_BLAME_EXECUTION_KIND,
  ATTR_BLAME_EXECUTION_RECOVERED,
  ATTR_BLAME_EXECUTION_STATUS,
  ATTR_BLAME_INTERVENTION_TYPE,
  ATTR_BLAME_MULTI_AGENT_ENABLED,
  ATTR_BLAME_MULTI_AGENT_USED,
  ATTR_BLAME_OPERATION_NAME,
  ATTR_BLAME_OPERATION_STATUS,
  ATTR_BLAME_PROVIDER_AUTH_TYPE,
  ATTR_BLAME_REPOSITORY_LANGUAGE,
  ATTR_BLAME_REPOSITORY_SIZE_BUCKET,
  ATTR_BLAME_RUNTIME_DEPENDENCY_NAME,
  ATTR_BLAME_RUNTIME_DEPENDENCY_STATUS,
  ATTR_BLAME_RUNTIME_INITIAL_STATE,
  ATTR_BLAME_RUNTIME_NAME,
  ATTR_BLAME_RUNTIME_OPERATION,
  ATTR_BLAME_RUNTIME_PHASE,
  ATTR_BLAME_RUNTIME_PROBE_NAME,
  ATTR_BLAME_RUNTIME_REPORT_STAGE,
  ATTR_BLAME_RUNTIME_STATE,
  ATTR_BLAME_TASK_COMPLEXITY_BUCKET,
  ATTR_BLAME_TOOL_CATEGORY,
  ATTR_BLAME_TOOL_NAME,
  ATTR_BLAME_TEST_STATUS,
  ATTR_ERROR_TYPE,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_TOOL_NAME,
  "gen_ai.token.type",
] as const;
const allowedMetricKeys = new Set<string>(allowedMetricAttributeKeys);
const privateTraceKeyPattern =
  /^(?:client\.(?:address|port)|code\.(?:file\.path|stacktrace)|db\.(?:collection\.name|namespace|query\.(?:summary|text)|statement|user)|error\.message|exception\.(?:message|stacktrace)|file\.path|http\.(?:request|response)\.header\..+|http\.(?:target|url|user_agent)|log\.file\.path|network\.peer\.(?:address|port)|process\.(?:command|command_args|command_line|executable\.path)|repository\.url|url\.(?:full|original|path|query)|user_agent\.original)$/i;

export function sanitizeAttributes(input: Record<string, unknown> = {}) {
  const attributes: Attributes = {};
  const entries = Object.entries(input).slice(0, maximumAttributeCount);
  for (const [key, value] of entries) {
    if (blockedKeyPattern.test(key)) continue;
    const sanitized = sanitizeAttributeValue(value);
    if (sanitized !== undefined) attributes[key] = sanitized;
  }
  return attributes;
}

export function metricAttributes(input: Record<string, unknown> = {}) {
  return withMetricErrorType(
    sanitizeAttributes(
      Object.fromEntries(
        Object.entries(input).filter(([key]) => allowedMetricKeys.has(key)),
      ),
    ),
  );
}

export function traceAttributes(input: Record<string, unknown> = {}) {
  return withBoundedErrorTypes(
    sanitizeAttributes(
      Object.fromEntries(
        Object.entries(input).filter(
          ([key]) => !privateTraceKeyPattern.test(key),
        ),
      ),
    ),
  );
}

export function sanitizeText(value: string) {
  const redacted = blockedValueReplacements.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );
  return redacted.slice(0, maximumStringLength);
}

export function errorAttributes(error: unknown) {
  if (error instanceof Error) {
    const type = boundedErrorType(error.name);
    return {
      "error.type": type,
      "exception.type": type,
    };
  }
  return {
    "error.type": "Error",
    "exception.type": "Error",
  };
}

export function opaqueIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function boundedErrorType(value: string) {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : "Error";
}

export function boundedMetricDimensionName(value: string) {
  if (value.includes("://")) return "other";
  if (sanitizeText(value) !== value) return "other";
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) ? value : "other";
}

export function withoutTelemetryEnvironment(environment: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !/^OTEL_/i.test(key)),
  );
}

function sanitizeAttributeValue(value: unknown): AttributeValue | undefined {
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (!Array.isArray(value)) return undefined;
  return sanitizeArray(value);
}

function sanitizeArray(value: unknown[]): AttributeValue | undefined {
  if (value.every((entry) => typeof entry === "string"))
    return value.map((entry) => sanitizeText(entry as string));
  if (value.every((entry) => typeof entry === "number"))
    return value.filter((entry) => Number.isFinite(entry)) as number[];
  if (value.every((entry) => typeof entry === "boolean"))
    return value as boolean[];
  return undefined;
}

function withBoundedErrorTypes(attributes: Attributes) {
  for (const key of [ATTR_ERROR_TYPE, ATTR_EXCEPTION_TYPE]) {
    const value = attributes[key];
    if (typeof value === "string") attributes[key] = boundedErrorType(value);
  }
  return attributes;
}

function withMetricErrorType(attributes: Attributes) {
  const value = attributes[ATTR_ERROR_TYPE];
  if (typeof value !== "string") return attributes;
  attributes[ATTR_ERROR_TYPE] = metricErrorTypes.has(value)
    ? value
    : "UnknownError";
  return attributes;
}

const metricErrorTypes = new Set([
  "AgentError",
  "ModelError",
  "ProviderApiError",
  "ProviderAuthenticationError",
  "ProviderRateLimitError",
  "ProviderTimeoutError",
  "ProviderUnavailableError",
  "RuntimeError",
  "ToolError",
  "UnknownError",
]);
