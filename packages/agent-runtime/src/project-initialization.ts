import type {
  PreviewManifest,
  ProjectInitializationPreferences,
  ProjectRunConfiguration,
} from "./types.js";
import {
  generatePreviewArtifacts,
  parsePreviewManifest,
  normalizePreviewManifestWithPreferences,
} from "./preview-manifest.js";
import { jsonPayload } from "./json-payload.js";
import type { ProjectInitializationScan } from "./project-initialization-scan.js";

export {
  scanProjectForInitialization,
  type ProjectInitializationScan,
} from "./project-initialization-scan.js";

const maxCorrectionPayloadLength = 24_000;

type ParsedProjectInitialization = {
  previewManifest?: PreviewManifest;
  setupScript: string;
  dockerCompose: string;
  runConfigurations: ProjectRunConfiguration[];
};

type ProjectInitializationCorrection = {
  validationError: string;
  previousResult: string;
};

export const projectInitializationResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["previewManifest", "runConfigurations"],
  properties: {
    previewManifest: {
      type: "object",
      additionalProperties: false,
      required: [
        "version",
        "confidence",
        "project",
        "setup",
        "services",
        "caches",
        "risks",
        "probes",
      ],
      properties: {
        version: { const: 2 },
        confidence: { enum: ["low", "medium", "high"] },
        project: {
          type: "object",
          additionalProperties: false,
          properties: {
            root: { type: "string" },
            detectedStack: { type: "array", items: { type: "string" } },
            confidence: { enum: ["low", "medium", "high"] },
          },
        },
        setup: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "image", "workingDir", "command"],
            properties: {
              id: { type: "string" },
              image: { type: "string" },
              workingDir: { type: "string" },
              command: { type: "string" },
              runAs: { enum: ["host", "root"] },
              environment: {
                type: "object",
                additionalProperties: { type: "string" },
              },
              dependsOn: { type: "array", items: { type: "string" } },
            },
          },
        },
        services: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "kind", "image", "endpoints"],
            properties: {
              id: { type: "string" },
              kind: { enum: ["preview", "dependency", "worker"] },
              image: { type: "string" },
              workingDir: { type: "string" },
              command: { type: "string" },
              environment: {
                type: "object",
                additionalProperties: { type: "string" },
              },
              dependsOn: { type: "array", items: { type: "string" } },
              preview: {
                type: "object",
                additionalProperties: false,
                required: ["internalPort", "protocol", "path"],
                properties: {
                  internalPort: { type: "integer", minimum: 1, maximum: 65535 },
                  protocol: { const: "http" },
                  path: { type: "string" },
                },
              },
              healthcheck: {
                type: "object",
                additionalProperties: false,
                required: ["type", "path", "timeoutMs"],
                properties: {
                  type: { const: "http" },
                  path: { type: "string" },
                  timeoutMs: {
                    type: "integer",
                    minimum: 1000,
                    maximum: 300000,
                  },
                },
              },
              endpoints: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "protocol", "port"],
                  properties: {
                    id: { type: "string" },
                    protocol: { enum: ["http", "https", "tcp"] },
                    port: { type: "integer", minimum: 1, maximum: 65535 },
                    healthcheck: {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "timeoutMs"],
                      properties: {
                        type: { enum: ["http", "tcp"] },
                        path: { type: "string" },
                        timeoutMs: {
                          type: "integer",
                          minimum: 1000,
                          maximum: 300000,
                        },
                      },
                    },
                  },
                },
              },
              bindings: {
                type: "array",
                maxItems: 50,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["target", "source", "exposure"],
                  properties: {
                    target: {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "key"],
                      properties: {
                        type: { const: "environment" },
                        key: { type: "string" },
                      },
                    },
                    source: {
                      type: "object",
                      additionalProperties: false,
                      required: ["service", "endpoint"],
                      properties: {
                        service: { type: "string" },
                        endpoint: { type: "string" },
                      },
                    },
                    exposure: { enum: ["server", "browser"] },
                    format: { enum: ["url", "host", "port", "host-port"] },
                    path: { type: "string" },
                  },
                },
              },
            },
          },
        },
        caches: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "target"],
            properties: {
              name: { type: "string" },
              target: { type: "string" },
            },
          },
        },
        risks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["level", "message"],
            properties: {
              level: { enum: ["low", "medium", "high"] },
              message: { type: "string" },
            },
          },
        },
        probes: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "from", "target", "type"],
            properties: {
              id: { type: "string" },
              from: { type: "string" },
              target: {
                type: "object",
                additionalProperties: false,
                required: ["service", "endpoint"],
                properties: {
                  service: { type: "string" },
                  endpoint: { type: "string" },
                  path: { type: "string" },
                },
              },
              type: { enum: ["http", "tcp"] },
              acceptedStatuses: {
                type: "array",
                maxItems: 20,
                items: { type: "integer", minimum: 100, maximum: 499 },
              },
              timeoutMs: { type: "integer", minimum: 1000, maximum: 300000 },
              required: { type: "boolean" },
            },
          },
        },
      },
    },
    runConfigurations: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "command",
          "cwd",
          "default",
          "category",
          "services",
          "scopes",
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          command: { type: "string" },
          cwd: { type: "string" },
          default: { type: "boolean" },
          category: {
            enum: ["web", "mobile", "desktop", "terminal", "service", "other"],
          },
          services: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 20,
          },
          previewService: { type: "string" },
          scopes: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 50,
          },
          previewUrl: { type: "string" },
        },
      },
    },
  },
} as const;

export function projectInitializationPrompt(scan: ProjectInitializationScan) {
  return [
    "Analyze this project scan according to your system instructions.",
    "Call submit_project_initialization exactly once with the complete result.",
    "Do not answer with JSON text.",
    "Use read_files or search_codebase only when a required runtime fact is absent from this evidence.",
    `Project evidence: ${JSON.stringify(scan)}`,
  ].join("\n");
}

export function projectInitializationCorrectionPrompt(
  scan: ProjectInitializationScan,
  correction: ProjectInitializationCorrection,
) {
  return [
    projectInitializationPrompt(scan),
    "Your previous tool input was rejected by validation.",
    "Call submit_project_initialization again with a complete corrected input.",
    "Do not broaden the analysis and do not read more files.",
    `Validation error: ${correction.validationError}`,
    `Previous rejected input: ${truncateCorrectionPayload(correction.previousResult)}`,
  ].join("\n");
}

export function parseProjectInitializationResult(
  text: string,
  scan?: ProjectInitializationScan,
  preferences?: ProjectInitializationPreferences,
): ParsedProjectInitialization {
  const parsed = JSON.parse(jsonPayload(text)) as unknown;
  return parseProjectInitializationPayload(parsed, scan, preferences);
}

export function parseProjectInitializationPayload(
  parsed: unknown,
  scan?: ProjectInitializationScan,
  preferences?: ProjectInitializationPreferences,
): ParsedProjectInitialization {
  if (!isRecord(parsed))
    throw new Error("Initialization result must be an object");
  const parsedManifest = parsed.previewManifest
    ? parsePreviewManifest(parsed.previewManifest)
    : undefined;
  const manifest = parsedManifest
    ? normalizePreviewManifestWithPreferences(parsedManifest, preferences)
    : undefined;
  const generated = manifest ? generatePreviewArtifacts(manifest) : undefined;
  const setupScript = generated?.setupScript ?? stringValue(parsed.setupScript);
  const dockerCompose =
    generated?.dockerCompose ?? stringValue(parsed.dockerCompose);
  if (!setupScript) {
    throw new Error("Initialization result is missing previewManifest");
  }
  if (!dockerCompose) {
    throw new Error("Initialization result is missing generated dockerCompose");
  }
  const runConfigurations = parseRunConfigurations(parsed.runConfigurations);
  validateProjectInitializationOutput(
    setupScript,
    dockerCompose,
    runConfigurations,
    scan,
    manifest,
  );
  return {
    previewManifest: manifest,
    setupScript,
    dockerCompose,
    runConfigurations,
  };
}

function validateRunConfigurationTopology(
  configurations: ProjectRunConfiguration[],
  manifest: PreviewManifest | undefined,
) {
  if (!manifest) return;
  const services = new Set(manifest.services.map(({ id }) => id));
  for (const configuration of configurations) {
    validateRunConfigurationServices(configuration, manifest, services);
  }
}

function validateRunConfigurationServices(
  configuration: ProjectRunConfiguration,
  manifest: PreviewManifest,
  services: Set<string>,
) {
  if (
    configuration.category &&
    configuration.category !== "web" &&
    configuration.previewService
  ) {
    throw new Error(
      `Initialization run configuration ${configuration.id} exposes a browser preview outside the web category`,
    );
  }
  for (const service of configuration.services ?? []) {
    if (!services.has(service)) {
      throw new Error(
        `Initialization run configuration ${configuration.id} references unknown service ${service}`,
      );
    }
    const manifestService = manifest.services.find(({ id }) => id === service);
    if (
      configuration.category &&
      configuration.category !== "web" &&
      manifestService?.kind === "preview"
    ) {
      throw new Error(
        `Initialization run configuration ${configuration.id} directly starts a browser preview outside the web category`,
      );
    }
  }
  if (!configuration.previewService) return;
  if (!services.has(configuration.previewService)) {
    throw new Error(
      `Initialization run configuration ${configuration.id} previewService is unknown`,
    );
  }
  const preview = manifest.services.find(
    ({ id }) => id === configuration.previewService,
  );
  if (preview?.kind !== "preview") {
    throw new Error(
      `Initialization run configuration ${configuration.id} previewService is not browser-facing`,
    );
  }
}

export function parseRunConfigurations(value: unknown) {
  if (!Array.isArray(value))
    throw new Error("Initialization result is missing runConfigurations");
  if (value.length > 20)
    throw new Error("Initialization result has too many runConfigurations");
  const configurations = value.map(parseRunConfiguration);
  const ids = new Set(configurations.map((configuration) => configuration.id));
  if (ids.size !== configurations.length)
    throw new Error(
      "Initialization result run configuration ids must be unique",
    );
  if (
    configurations.filter((configuration) => configuration.default).length > 1
  )
    throw new Error(
      "Initialization result must have at most one default run configuration",
    );
  return configurations;
}

function parseRunConfiguration(value: unknown): ProjectRunConfiguration {
  if (!isRecord(value))
    throw new Error("Initialization run configuration must be an object");
  return {
    ...parseRunConfigurationBase(value),
    ...parseRunConfigurationTopology(value),
  };
}

function parseRunConfigurationBase(value: Record<string, unknown>) {
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const command = stringValue(value.command);
  const cwd = stringValue(value.cwd);
  const previewUrl = stringValue(value.previewUrl);
  if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new Error("Initialization run configuration id is invalid");
  if (!name || name.length > 120)
    throw new Error("Initialization run configuration name is invalid");
  if (!command || command.length > 2_000 || /[\r\n]/.test(command))
    throw new Error("Initialization run configuration command is invalid");
  if (!cwd || cwd.length > 500 || unsafeRunConfigurationCwd(cwd))
    throw new Error(
      "Initialization run configuration cwd must stay inside the project",
    );
  if (typeof value.default !== "boolean")
    throw new Error("Initialization run configuration default must be boolean");
  if (previewUrl && invalidRunConfigurationPreviewUrl(previewUrl))
    throw new Error("Initialization run configuration previewUrl is invalid");
  return {
    id,
    name,
    command,
    cwd,
    default: value.default,
    ...(previewUrl ? { previewUrl } : {}),
  };
}

function parseRunConfigurationTopology(value: Record<string, unknown>) {
  const category = parseRunConfigurationCategory(value.category);
  const services = parseRunConfigurationStrings(value.services, "services", 20);
  const scopes = parseRunConfigurationStrings(value.scopes, "scopes", 50);
  const previewService = stringValue(value.previewService);
  if (category && !services.length) {
    throw new Error(
      "Initialization run configuration services must not be empty",
    );
  }
  if (category && !scopes.length) {
    throw new Error(
      "Initialization run configuration scopes must not be empty",
    );
  }
  if (category === "web" && !previewService) {
    throw new Error(
      "Initialization web run configuration requires previewService",
    );
  }
  if (previewService && !services.includes(previewService)) {
    throw new Error(
      "Initialization run configuration previewService must be a configured service",
    );
  }
  return {
    ...(category ? { category } : {}),
    ...(services.length ? { services } : {}),
    ...(previewService ? { previewService } : {}),
    ...(scopes.length ? { scopes } : {}),
  };
}

function parseRunConfigurationCategory(
  value: unknown,
): ProjectRunConfiguration["category"] {
  if (value === undefined) return undefined;
  if (
    value !== "web" &&
    value !== "mobile" &&
    value !== "desktop" &&
    value !== "terminal" &&
    value !== "service" &&
    value !== "other"
  ) {
    throw new Error("Initialization run configuration category is invalid");
  }
  return value;
}

function parseRunConfigurationStrings(
  value: unknown,
  field: string,
  maximum: number,
) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some(
      (entry) =>
        typeof entry !== "string" || !entry.trim() || entry.length > 500,
    )
  ) {
    throw new Error(`Initialization run configuration ${field} is invalid`);
  }
  return Array.from(new Set((value as string[]).map((entry) => entry.trim())));
}

function unsafeRunConfigurationCwd(cwd: string) {
  return (
    cwd.startsWith("/") ||
    cwd.startsWith("\\") ||
    /^[a-zA-Z]:/.test(cwd) ||
    cwd.split(/[\\/]/).includes("..")
  );
}

function invalidRunConfigurationPreviewUrl(previewUrl: string) {
  return previewUrl.length > 2_048 || /[\r\n]/.test(previewUrl);
}

export function validateProjectInitializationArtifacts(
  script: string,
  compose: string,
  scan?: ProjectInitializationScan,
  manifest?: PreviewManifest,
) {
  const normalizedScript = script.toLowerCase();
  const normalizedCompose = compose.toLowerCase();
  if (launchesCompose(normalizedScript)) {
    throw new Error(
      "Initialization result setupScript must not launch compose",
    );
  }
  if (requiresDockerRuntime(normalizedScript)) {
    throw new Error(
      "Initialization result setupScript must not require Docker or Docker Compose",
    );
  }
  validateDockerCompose(normalizedCompose, scan, manifest);
}

export function validateProjectInitializationOutput(
  script: string,
  compose: string,
  configurations: ProjectRunConfiguration[],
  scan?: ProjectInitializationScan,
  manifest?: PreviewManifest,
) {
  validateRunConfigurationTopology(configurations, manifest);
  validateProjectInitializationArtifacts(script, compose, scan, manifest);
}

function validateDockerCompose(
  compose: string,
  scan?: ProjectInitializationScan,
  manifest?: PreviewManifest,
) {
  const duplicateKey = duplicateYamlMappingKey(compose);
  if (duplicateKey) {
    throw new Error(
      `Initialization result dockerCompose must not define duplicate YAML key "${duplicateKey}" in the same mapping`,
    );
  }
  if (!compose.includes("services:")) {
    throw new Error("Initialization result dockerCompose must define services");
  }
  if (usesManualHostPort(compose)) {
    throw new Error(
      "Initialization result dockerCompose must let the runtime allocate host ports",
    );
  }
  if (
    requiresRuntimeAllocatedPort(manifest) &&
    !hasRuntimeAllocatedPortMapping(compose)
  ) {
    throw new Error(
      "Initialization result dockerCompose must expose runtime-allocated host ports",
    );
  }
  if (usesProjectDockerfileBuild(compose)) {
    throw new Error(
      "Initialization result dockerCompose must not build from project Dockerfiles",
    );
  }
  if (forcesHostUidUser(compose)) {
    throw new Error(
      "Initialization result dockerCompose must not force BLAME_HOST_UID as the container user",
    );
  }
  if (!previewWorkspaceMountsProject(compose)) {
    throw new Error(
      "Initialization result dockerCompose preview service must mount the project source at /workspace",
    );
  }
  if (missingNodeDependencyInstall(compose, scan, manifest)) {
    throw new Error(
      "Initialization result dockerCompose must install detected Node dependencies before starting services",
    );
  }
  if (usesNuxtPreviewWithoutBuild(compose, scan, manifest)) {
    throw new Error(
      "Initialization result dockerCompose must build Nuxt before running its preview script or use the development script",
    );
  }
  if (compose.includes("corepack enable")) {
    throw new Error(
      "Initialization result dockerCompose must not run corepack enable",
    );
  }
  if (usesUnescapedContainerHome(compose)) {
    throw new Error(
      "Initialization result dockerCompose must escape container HOME references as $$HOME or $${HOME}",
    );
  }
  if (overridesEnvironmentDrivenServeCommand(compose)) {
    throw new Error(
      "Initialization result dockerCompose must not append host or port flags to serve commands when HOST and PORT environment variables are already configured",
    );
  }
  if (usesInterpolatedContainerHost(compose)) {
    throw new Error(
      "Initialization result dockerCompose must bind preview services to a literal 0.0.0.0 instead of preserving an existing HOST value",
    );
  }
  if (usesInterpolatedServiceUrl(compose)) {
    throw new Error(
      "Initialization result dockerCompose must use literal service URLs for inter-container runtime configuration instead of preserving existing localhost values",
    );
  }
  if (
    requiresDatabaseMigration(compose, scan, manifest) &&
    !runsDatabaseMigration(compose)
  ) {
    throw new Error(
      "Initialization result dockerCompose must run detected database migrations before starting backend services",
    );
  }
  if (usesBarePnpm(compose)) {
    throw new Error(
      "Initialization result dockerCompose must run pnpm through corepack",
    );
  }
  if (usesNpmCi(compose)) {
    throw new Error(
      "Initialization result dockerCompose must use npm install --no-package-lock instead of npm ci",
    );
  }
  if (usesNumericSuUser(compose)) {
    throw new Error(
      "Initialization result dockerCompose must not run commands through su with numeric BLAME_HOST_UID users",
    );
  }
  if (
    usesNodeModulesVolumes(compose) &&
    !initializesNodeModulesVolumes(compose)
  ) {
    throw new Error(
      "Initialization result dockerCompose must make node_modules volumes writable by the host user before package installs",
    );
  }
}

function requiresRuntimeAllocatedPort(manifest: PreviewManifest | undefined) {
  if (!manifest) return true;
  return manifest.services.some(({ kind }) => kind === "preview");
}

function launchesCompose(script: string) {
  return composeCommandPresent(script) && composeLifecyclePresent(script);
}

function requiresDockerRuntime(script: string) {
  return /\b(?:command\s+-v\s+docker|docker\s+--version|docker\s+compose\s+version|docker-compose\s+--version)\b/.test(
    script,
  );
}

function usesUnescapedContainerHome(compose: string) {
  return /(?<!\$)\$(?:home\b|\{home\})/.test(compose);
}

function usesNpmCi(compose: string) {
  return /\bnpm\s+ci\b/.test(compose);
}

function usesManualHostPort(compose: string) {
  return (
    /\$\{[a-z0-9_]*port\}:/.test(compose) ||
    /(?:127\.0\.0\.1|localhost):[0-9]+:[0-9]+/.test(compose)
  );
}

function hasRuntimeAllocatedPortMapping(compose: string) {
  return includesOneOf(compose, ["127.0.0.1::", "localhost::"]);
}

function usesProjectDockerfileBuild(compose: string) {
  return /\bbuild\s*:/.test(compose) || /\bdockerfile\s*:/.test(compose);
}

function forcesHostUidUser(compose: string) {
  return /user\s*:\s*["']?\$\{?blame_host_uid\}?/i.test(compose);
}

function previewWorkspaceMountsProject(compose: string) {
  if (
    !compose.includes("blame.preview") ||
    !compose.includes("working_dir: /workspace")
  ) {
    return true;
  }
  return /(?:-\s*[^:\n]+:\s*\/workspace|target:\s*\/workspace)\s*(?:#.*)?$/m.test(
    compose,
  );
}

function missingNodeDependencyInstall(
  compose: string,
  scan: ProjectInitializationScan | undefined,
  manifest: PreviewManifest | undefined,
) {
  if (!scan || !compose.includes("image: node:")) return false;
  const files = relevantInitializationFiles(scan, manifest);
  if (!files.some(([path]) => path.endsWith("package.json"))) {
    return false;
  }
  return !/\b(?:npm\s+(?:ci|install)|corepack\s+pnpm\s+install|yarn\s+install|bun\s+install)\b/.test(
    compose,
  );
}

function usesNuxtPreviewWithoutBuild(
  compose: string,
  scan: ProjectInitializationScan | undefined,
  manifest: PreviewManifest | undefined,
) {
  if (!scan || !/\bnpm\s+run\s+preview\b/.test(compose)) return false;
  const usesNuxt = relevantInitializationFiles(scan, manifest).some(
    ([path, content]) =>
      path.endsWith("package.json") && /"nuxt"\s*:/.test(content.toLowerCase()),
  );
  return usesNuxt && !/\b(?:npm\s+run\s+build|nuxt\s+build)\b/.test(compose);
}

function usesBarePnpm(compose: string) {
  return /(^|[\s;&|])pnpm\s/.test(compose.replace(/corepack\s+pnpm/g, ""));
}

function usesNumericSuUser(compose: string) {
  return /\bsu\s+-s\s+\/bin\/bash\s+-c\b[\s\S]*['"]#\$\{blame_host_uid\}['"]/.test(
    compose,
  );
}

function overridesEnvironmentDrivenServeCommand(compose: string) {
  if (!/\bhost:\s*0\.0\.0\.0\b/.test(compose)) return false;
  if (!/\bport:\s*[0-9]+\b/.test(compose)) return false;
  return /\b(?:node\s+ace|ace)\s+serve\b[^\n]*(?:--host|--port)\b/.test(
    compose,
  );
}

function usesInterpolatedContainerHost(compose: string) {
  return /\bhost:\s*\$\{host:-0\.0\.0\.0\}/.test(compose);
}

function usesInterpolatedServiceUrl(compose: string) {
  return /\b[a-z0-9_]*(?:api|backend)[a-z0-9_]*url:\s*\$\{[a-z0-9_]+:-http:\/\/[a-z0-9_-]+:[0-9]+[^}]*\}/.test(
    compose,
  );
}

function requiresDatabaseMigration(
  compose: string,
  scan: ProjectInitializationScan | undefined,
  manifest: PreviewManifest | undefined,
) {
  if (!scan || !usesRelationalDatabase(compose)) return false;
  const scopes = initializationEvidenceScopes(manifest);
  if (scan.discovery?.migrationPaths.some((path) => pathInScopes(path, scopes))) {
    return true;
  }
  return relevantInitializationFiles(scan, manifest).some(([path, content]) => {
    return path.endsWith("/migrations/") && content.trim().length > 0;
  });
}

function relevantInitializationFiles(
  scan: ProjectInitializationScan,
  manifest: PreviewManifest | undefined,
) {
  const scopes = initializationEvidenceScopes(manifest);
  return Object.entries(scan.files).filter(([path]) => pathInScopes(path, scopes));
}

function initializationEvidenceScopes(manifest: PreviewManifest | undefined) {
  if (!manifest) return ["."];
  const root = normalizedEvidenceScope(manifest.project.root);
  if (root !== ".") return [root];
  const serviceScopes = manifest.services.flatMap(({ workingDir }) =>
    workingDir ? [normalizedEvidenceScope(workingDir)] : [],
  );
  if (serviceScopes.includes(".")) return ["."];
  return serviceScopes.length ? [...new Set(serviceScopes)] : ["."];
}

function normalizedEvidenceScope(path: string | undefined) {
  const normalized = path?.replaceAll("\\", "/").replace(/^\/workspace\/?/, "");
  return normalized?.replace(/^\.\//, "").replace(/\/$/, "") || ".";
}

function pathInScopes(path: string, scopes: string[]) {
  return scopes.some(
    (scope) => scope === "." || path === scope || path.startsWith(`${scope}/`),
  );
}

function usesRelationalDatabase(compose: string) {
  return /\b(?:mysql|mariadb|postgres|postgresql):/.test(compose);
}

function runsDatabaseMigration(compose: string) {
  return /\b(?:migration:run|migrate\s+(?:deploy|dev|up|latest|run)|db:migrate|drizzle-kit\s+migrate|knex\s+migrate:latest)\b/.test(
    compose,
  );
}

function usesNodeModulesVolumes(compose: string) {
  return /:\s*\/[^\n]*node_modules\b|target:\s*\/[^\n]*node_modules\b/.test(
    compose,
  );
}

function initializesNodeModulesVolumes(compose: string) {
  return /\bchown\b[\s\S]*node_modules\b/.test(compose);
}

function composeCommandPresent(value: string) {
  return /docker\s+compose|docker-compose|compose_cmd|docker_compose|compose command|compose binary/.test(
    value,
  );
}

function composeLifecyclePresent(value: string) {
  return /\bup\b|\brun\b|\bstart\b/.test(value);
}

function includesOneOf(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

function duplicateYamlMappingKey(compose: string) {
  const stack: Array<{ indent: number; keys: Set<string> }> = [
    { indent: -1, keys: new Set() },
  ];
  for (const line of compose.split("\n")) {
    const key = yamlMappingKey(line);
    if (!key) continue;
    while (stack.length > 1 && stack[stack.length - 1].indent >= key.indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent.keys.has(key.name)) return key.name;
    parent.keys.add(key.name);
    stack.push({ indent: key.indent, keys: new Set() });
  }
  return undefined;
}

function yamlMappingKey(line: string) {
  const match = /^(\s*)([a-z0-9_.-]+):(?:\s|$)/.exec(line);
  if (!match?.[2] || line.trimStart().startsWith("-")) return undefined;
  return { indent: match[1].length, name: match[2] };
}

function truncateCorrectionPayload(value: string) {
  if (value.length <= maxCorrectionPayloadLength) return value;
  return value.slice(0, maxCorrectionPayloadLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
