import type {
  DeploymentCompatibilityStatus,
  DeploymentDiagnostic,
  DeploymentManifest,
} from "./types.js";

const compatibilityStatuses = new Set<DeploymentCompatibilityStatus>([
  "supported",
  "conditional",
  "unsupported",
]);

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
  if (!isRecord(value)) throw new Error("deploymentManifest must be an object");
  assertOnlyKeys(value, "deploymentManifest", [
    "provider",
    "rootDirectory",
    "framework",
    "installCommand",
    "buildCommand",
    "outputDirectory",
    "runConfigurationId",
    "previewServiceId",
    "requiredEnvironmentKeys",
    "compatibility",
  ]);
  if (value.provider !== "vercel") {
    throw new Error("deploymentManifest provider is invalid");
  }
  const manifest: DeploymentManifest = {
    provider: "vercel",
    rootDirectory: relativePath(value.rootDirectory, "rootDirectory"),
    framework: nullableFramework(value.framework),
    installCommand: optionalCommand(value.installCommand, "installCommand"),
    buildCommand: optionalCommand(value.buildCommand, "buildCommand"),
    outputDirectory: optionalRelativePath(
      value.outputDirectory,
      "outputDirectory",
    ),
    runConfigurationId: optionalId(
      value.runConfigurationId,
      "runConfigurationId",
    ),
    previewServiceId: optionalId(value.previewServiceId, "previewServiceId"),
    requiredEnvironmentKeys: environmentKeys(value.requiredEnvironmentKeys),
    compatibility: compatibility(value.compatibility),
  };
  return withoutUndefined(manifest);
}

function compatibility(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("deploymentManifest compatibility must be an object");
  }
  assertOnlyKeys(value, "compatibility", ["status", "blockers", "warnings"]);
  if (
    typeof value.status !== "string" ||
    !compatibilityStatuses.has(value.status as DeploymentCompatibilityStatus)
  ) {
    throw new Error("deploymentManifest compatibility status is invalid");
  }
  const blockers = diagnostics(value.blockers, "blockers");
  const warnings = diagnostics(value.warnings, "warnings");
  if (value.status === "unsupported" && blockers.length === 0) {
    throw new Error("unsupported deploymentManifest requires a blocker");
  }
  if (value.status !== "unsupported" && blockers.length > 0) {
    throw new Error("supported deploymentManifest cannot contain blockers");
  }
  return {
    status: value.status as DeploymentCompatibilityStatus,
    blockers,
    warnings,
  };
}

function diagnostics(value: unknown, field: string): DeploymentDiagnostic[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error(`deploymentManifest ${field} must be an array`);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`deploymentManifest ${field}[${index}] is invalid`);
    }
    assertOnlyKeys(item, `${field}[${index}]`, ["code", "message", "action"]);
    const code = requiredString(item.code, `${field}[${index}].code`, 80);
    if (!/^DEPLOY_[A-Z0-9_]+$/.test(code)) {
      throw new Error(`deploymentManifest ${field}[${index}].code is invalid`);
    }
    return withoutUndefined({
      code,
      message: requiredString(item.message, `${field}[${index}].message`, 500),
      action: optionalString(item.action, `${field}[${index}].action`, 200),
    });
  });
}

function environmentKeys(value: unknown) {
  if (!Array.isArray(value) || value.length > 200) {
    throw new Error("deploymentManifest requiredEnvironmentKeys is invalid");
  }
  const keys = value.map((item, index) => {
    const key = requiredString(item, `requiredEnvironmentKeys[${index}]`, 128);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error("deploymentManifest environment key is invalid");
    }
    return key;
  });
  if (new Set(keys).size !== keys.length) {
    throw new Error("deploymentManifest environment keys must be unique");
  }
  return keys;
}

function nullableFramework(value: unknown) {
  if (value === null) return null;
  const framework = requiredString(value, "framework", 80);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(framework)) {
    throw new Error("deploymentManifest framework is invalid");
  }
  return framework;
}

function optionalCommand(value: unknown, field: string) {
  if (value === undefined) return undefined;
  const command = requiredString(value, field, 500);
  if (
    /[\r\n\0<>`]/.test(command) ||
    /\$\s*\(/.test(command) ||
    /(?:^|\s)(?:dev|serve|watch)(?:\s|$)/i.test(command)
  ) {
    throw new Error(`deploymentManifest ${field} is unsafe`);
  }
  return command;
}

function relativePath(value: unknown, field: string) {
  const path = requiredString(value, field, 512).replaceAll("\\", "/");
  if (path === "." || path === "./") return ".";
  if (
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    path.includes("\0") ||
    path.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(
      `deploymentManifest ${field} must stay inside the workspace`,
    );
  }
  return path.replace(/^\.\//, "");
}

function optionalRelativePath(value: unknown, field: string) {
  return value === undefined ? undefined : relativePath(value, field);
}

function optionalId(value: unknown, field: string) {
  if (value === undefined) return undefined;
  const id = requiredString(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`deploymentManifest ${field} is invalid`);
  }
  return id;
}

function requiredString(value: unknown, field: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(`deploymentManifest ${field} is invalid`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, maximum: number) {
  return value === undefined
    ? undefined
    : requiredString(value, field, maximum);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  field: string,
  allowed: string[],
) {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported) {
    throw new Error(
      `deploymentManifest ${field} has unsupported field ${unsupported}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
