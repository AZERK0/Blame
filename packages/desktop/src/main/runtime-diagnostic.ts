import {
  ATTR_BLAME_EXECUTION_STATUS,
  ATTR_BLAME_OPERATION_NAME,
  ATTR_BLAME_RUNTIME_NAME,
  ATTR_BLAME_RUNTIME_OPERATION,
  ATTR_ERROR_TYPE,
  forceFlushBlameTelemetryLogs,
  getBlameTelemetry,
} from "@blame/telemetry";
import type { RuntimeDiagnosticInput } from "@blame/app";
import { runtimeName } from "./container-runtime.ts";
import { desktopTelemetryReady } from "./desktop-telemetry.ts";

type RuntimeDiagnosticLogger = {
  log(
    severity: "error",
    eventName: string,
    attributes: Record<string, unknown>,
  ): void;
};

export type RuntimeDiagnosticDependencies = {
  flush(): Promise<void>;
  ready(): boolean;
  telemetry: RuntimeDiagnosticLogger;
};

export async function sendRuntimeDiagnostic(
  value: unknown,
  dependencies: RuntimeDiagnosticDependencies = diagnosticDependencies(),
) {
  const input = parseRuntimeDiagnosticInput(value);
  if (!input || !dependencies.ready()) return false;
  try {
    dependencies.telemetry.log(
      "error",
      "blame.runtime.diagnostic.submitted",
      diagnosticAttributes(input),
    );
    await dependencies.flush();
    return true;
  } catch {
    return false;
  }
}

function parseRuntimeDiagnosticInput(
  value: unknown,
): RuntimeDiagnosticInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!runtimeDiagnosticOperation(input.operation)) return null;
  if (typeof input.detail !== "string") return null;
  const detail = input.detail.trim().slice(0, 4_096);
  return detail ? { detail, operation: input.operation } : null;
}

function runtimeDiagnosticOperation(
  value: unknown,
): value is RuntimeDiagnosticInput["operation"] {
  return value === "ensure" || value === "repair" || value === "reset";
}

function diagnosticAttributes(input: RuntimeDiagnosticInput) {
  return {
    [ATTR_BLAME_EXECUTION_STATUS]: "failed",
    [ATTR_BLAME_OPERATION_NAME]: "blame.runtime.diagnostic.submit",
    [ATTR_BLAME_RUNTIME_NAME]: runtimeName(process.platform),
    [ATTR_BLAME_RUNTIME_OPERATION]: input.operation,
    [ATTR_ERROR_TYPE]: "RuntimeError",
    "blame.runtime.diagnostic.detail": input.detail,
  };
}

function diagnosticDependencies(): RuntimeDiagnosticDependencies {
  return {
    flush: forceFlushBlameTelemetryLogs,
    ready: desktopTelemetryReady,
    telemetry: getBlameTelemetry(),
  };
}
