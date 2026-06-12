import type {
  PreviewManifest,
  PreviewManifestCache,
  PreviewManifestEnvironment,
  PreviewManifestHealthcheck,
  PreviewManifestProject,
  PreviewManifestRisk,
  PreviewManifestService,
  PreviewManifestServiceKind,
  PreviewManifestSetupTask,
} from "./types.js";

type GeneratedInitializationArtifacts = {
  dockerCompose: string;
  setupScript: string;
};

const serviceKinds = new Set<PreviewManifestServiceKind>([
  "preview",
  "dependency",
  "worker",
]);
const confidenceValues = new Set(["low", "medium", "high"]);
const riskLevels = new Set(["low", "medium", "high"]);
const unsafeCommandPatterns = [
  /\brm\s+-rf\s+\/(?:\s|$)/,
  /\bsudo\b/,
  /\bchmod\s+-R\s+777\s+\/(?:\s|$)/,
  /\bcurl\b[\s\S]*\|\s*(?:sh|bash)\b/,
  /\bwget\b[\s\S]*\|\s*(?:sh|bash)\b/,
  /\bssh-keygen\b/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-fdx\b/,
  /\b--privileged\b/,
  /\bnetwork_mode\s*:\s*host\b/,
  /\/var\/run\/docker\.sock/,
  /\bdocker\.sock\b/,
];

export function parsePreviewManifest(value: unknown): PreviewManifest {
  if (!isRecord(value)) throw new Error("previewManifest must be an object");
  const manifest: PreviewManifest = {
    version: parseVersion(value.version),
    confidence: parseConfidence(value.confidence),
    project: parseProject(value.project),
    setup: parseSetupTasks(value.setup),
    services: parseServices(value.services),
    caches: parseCaches(value.caches),
    risks: parseRisks(value.risks),
  };
  validatePreviewManifest(manifest);
  return normalizePreviewManifest(manifest);
}

export function generatePreviewArtifacts(
  manifest: PreviewManifest,
): GeneratedInitializationArtifacts {
  const normalized = normalizePreviewManifest(manifest);
  validatePreviewManifest(normalized);
  return {
    setupScript: setupScript(),
    dockerCompose: composeYaml(normalized),
  };
}

export function validatePreviewManifest(manifest: PreviewManifest) {
  if (manifest.version !== 1) {
    throw new Error("previewManifest version must be 1");
  }
  uniqueIds("setup task", manifest.setup.map((task) => task.id));
  uniqueIds("service", manifest.services.map((service) => service.id));
  uniqueIds("cache", manifest.caches.map((cache) => cache.name));
  const knownIds = new Set([
    ...manifest.setup.map((task) => task.id),
    ...manifest.services.map((service) => service.id),
  ]);
  for (const task of manifest.setup) validateSetupTask(task, knownIds);
  for (const service of manifest.services) validateService(service, knownIds);
  for (const cache of manifest.caches) validateCache(cache);
  if (!manifest.services.some((service) => service.kind === "preview")) {
    throw new Error("previewManifest must define a preview service");
  }
}

export function normalizePreviewManifest(
  manifest: PreviewManifest,
): PreviewManifest {
  const caches = normalizedCaches(manifest);
  return {
    ...manifest,
    project: {
      root: manifest.project.root || ".",
      detectedStack: manifest.project.detectedStack ?? [],
      confidence: manifest.project.confidence ?? manifest.confidence,
    },
    setup: manifest.setup.map((task) => ({
      ...task,
      workingDir: task.workingDir || "/workspace",
      environment: normalizedEnvironment(task.environment ?? {}, caches),
      dependsOn: uniqueStrings(task.dependsOn ?? []),
    })),
    services: manifest.services.map((service) =>
      normalizeService(service, caches),
    ),
    caches,
    risks: manifest.risks,
  };
}

function normalizeService(
  service: PreviewManifestService,
  caches: PreviewManifestCache[],
): PreviewManifestService {
  const previewEnvironment: PreviewManifestEnvironment =
    service.kind === "preview" && service.preview
      ? {
          HOST: "0.0.0.0",
          PORT: String(service.preview.internalPort),
        }
      : {};
  return {
    ...service,
    workingDir: service.workingDir || "/workspace",
    environment: normalizedEnvironment(
      { ...service.environment, ...previewEnvironment },
      caches,
    ),
    dependsOn: uniqueStrings(service.dependsOn ?? []),
  };
}

function normalizedCaches(manifest: PreviewManifest) {
  const cacheByName = new Map<string, PreviewManifestCache>();
  for (const cache of manifest.caches) cacheByName.set(cache.name, cache);
  const commands = [
    ...manifest.setup.map((task) => task.command),
    ...manifest.services.map((service) => service.command ?? ""),
  ].join("\n");
  if (runsNodePackageManager(commands)) {
    cacheByName.set("blame_node_modules", {
      name: "blame_node_modules",
      target: "/workspace/node_modules",
    });
  }
  if (/\bcorepack\s+prepare\b/.test(commands)) {
    cacheByName.set("blame_corepack_cache", {
      name: "blame_corepack_cache",
      target: "/tmp/corepack-cache",
    });
  }
  if (/\b(?:corepack\s+)?pnpm\s+(?:install|ci|exec|run)\b/.test(commands)) {
    cacheByName.set("blame_pnpm_store", {
      name: "blame_pnpm_store",
      target: "/pnpm/store",
    });
  }
  if (/\bnpm\s+(?:install|run|exec)\b/.test(commands)) {
    cacheByName.set("blame_npm_cache", {
      name: "blame_npm_cache",
      target: "/npm/cache",
    });
  }
  return Array.from(cacheByName.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function normalizedEnvironment(
  environment: PreviewManifestEnvironment,
  caches: PreviewManifestCache[],
) {
  return {
    ...environment,
    ...cacheEnvironment(caches),
  };
}

function cacheEnvironment(caches: PreviewManifestCache[]) {
  const byTarget = new Map(caches.map((cache) => [cache.target, cache.name]));
  return {
    ...(byTarget.has("/tmp/corepack-cache")
      ? { COREPACK_HOME: "/tmp/corepack-cache" }
      : {}),
    ...(byTarget.has("/pnpm/store")
      ? { npm_config_store_dir: "/pnpm/store" }
      : {}),
    ...(byTarget.has("/npm/cache")
      ? { NPM_CONFIG_CACHE: "/npm/cache" }
      : {}),
  };
}

function setupScript() {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `export COMPOSE_PROJECT_NAME="\${COMPOSE_PROJECT_NAME:-blame_$(pwd | cksum | awk '{print $1}')}"`,
    `export BLAME_PROJECT_ROOT="\${BLAME_PROJECT_ROOT:-$(pwd)}"`,
    `export BLAME_HOST_UID="\${BLAME_HOST_UID:-$(id -u 2>/dev/null || echo 1000)}"`,
    `export BLAME_HOST_GID="\${BLAME_HOST_GID:-$(id -g 2>/dev/null || echo 1000)}"`,
    "",
  ].join("\n");
}

function composeYaml(manifest: PreviewManifest) {
  const lines = [
    "services:",
    ...volumeInitService(manifest.caches),
    ...manifest.setup.flatMap((task) => setupTaskYaml(task, manifest.caches)),
    ...manifest.services.flatMap((service) =>
      serviceYaml(service, manifest.setup, manifest.caches),
    ),
    "volumes:",
    ...manifest.caches.flatMap((cache) => [`  ${cache.name}:`]),
  ];
  return lines.join("\n");
}

function volumeInitService(caches: PreviewManifestCache[]) {
  if (caches.length === 0) return [];
  const targets = caches.map((cache) => cache.target).join(" ");
  return [
    "  blame-volumes-init:",
    "    image: node:22-bookworm-slim",
    `    command: ${yamlString(`sh -lc "mkdir -p ${targets} && chown -R \${BLAME_HOST_UID}:\${BLAME_HOST_GID} ${targets}"`)}`,
    "    volumes:",
    ...caches.map((cache) =>
      `      - ${yamlString(`${cache.name}:${cache.target}`)}`,
    ),
  ];
}

function setupTaskYaml(
  task: PreviewManifestSetupTask,
  caches: PreviewManifestCache[],
) {
  return [
    `  ${task.id}:`,
    `    image: ${yamlString(task.image)}`,
    `    user: "\${BLAME_HOST_UID}:\${BLAME_HOST_GID}"`,
    `    working_dir: ${yamlString(task.workingDir ?? "/workspace")}`,
    `    command: ${yamlString(`sh -lc ${shellQuote(task.command)}`)}`,
    "    labels:",
    `      blame.setup: "true"`,
    ...environmentYaml(task.environment ?? {}),
    ...dependsOnYaml([
      ...(caches.length > 0 ? [dependsOnEntry("blame-volumes-init")] : []),
      ...(task.dependsOn ?? []).map((id) => dependsOnEntry(id)),
    ]),
    ...volumeYaml(caches, true),
  ];
}

function serviceYaml(
  service: PreviewManifestService,
  setup: PreviewManifestSetupTask[],
  caches: PreviewManifestCache[],
) {
  return [
    `  ${service.id}:`,
    `    image: ${yamlString(service.image)}`,
    ...(service.kind === "dependency"
      ? []
      : [`    user: "\${BLAME_HOST_UID}:\${BLAME_HOST_GID}"`]),
    ...(service.kind === "dependency" && !service.command
      ? []
      : [`    working_dir: ${yamlString(service.workingDir ?? "/workspace")}`]),
    ...(service.command
      ? [`    command: ${yamlString(`sh -lc ${shellQuote(service.command)}`)}`]
      : []),
    ...environmentYaml(service.environment ?? {}),
    ...labelsYaml(service),
    ...portsYaml(service),
    ...healthcheckYaml(service.healthcheck, service.preview),
    ...dependsOnYaml([
      ...(caches.length > 0 ? [dependsOnEntry("blame-volumes-init")] : []),
      ...setup.map((task) =>
        dependsOnEntry(task.id, "service_completed_successfully"),
      ),
      ...(service.dependsOn ?? []).map((id) => dependsOnEntry(id)),
    ]),
    ...volumeYaml(caches, service.kind !== "dependency"),
  ];
}

function labelsYaml(service: PreviewManifestService) {
  if (service.kind !== "preview" || !service.preview) return [];
  return [
    "    labels:",
    `      blame.preview: "true"`,
    `      blame.preview.port: ${yamlString(String(service.preview.internalPort))}`,
    `      blame.preview.protocol: ${yamlString(service.preview.protocol)}`,
    `      blame.preview.path: ${yamlString(service.preview.path)}`,
  ];
}

function portsYaml(service: PreviewManifestService) {
  if (service.kind !== "preview" || !service.preview) return [];
  return [
    "    ports:",
    `      - ${yamlString(`127.0.0.1::${service.preview.internalPort}`)}`,
  ];
}

function healthcheckYaml(
  healthcheck: PreviewManifestHealthcheck | undefined,
  preview: PreviewManifestService["preview"],
) {
  if (!healthcheck || !preview) return [];
  const retries = Math.max(1, Math.ceil(healthcheck.timeoutMs / 5_000));
  const url = `http://127.0.0.1:${preview.internalPort}${healthcheck.path}`;
  const command = `node -e "fetch('${url}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`;
  return [
    "    healthcheck:",
    "      test:",
    `        - CMD-SHELL`,
    `        - ${yamlString(command)}`,
    "      interval: 5s",
    "      timeout: 5s",
    `      retries: ${retries}`,
  ];
}

function environmentYaml(environment: PreviewManifestEnvironment) {
  const entries = Object.entries(environment).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) return [];
  return [
    "    environment:",
    ...entries.map(([key, value]) => `      ${key}: ${yamlString(value)}`),
  ];
}

function dependsOnYaml(
  services: Array<{ condition?: string; id: string }>,
) {
  const uniqueServices = uniqueDependsOnEntries(services);
  if (uniqueServices.length === 0) return [];
  return [
    "    depends_on:",
    ...uniqueServices.flatMap((service) =>
      service.condition
        ? [`      ${service.id}:`, `        condition: ${service.condition}`]
        : [`      ${service.id}:`],
    ),
  ];
}

function dependsOnEntry(id: string, condition?: string) {
  return { condition, id };
}

function uniqueDependsOnEntries(services: Array<{ condition?: string; id: string }>) {
  const entries = new Map<string, { condition?: string; id: string }>();
  for (const service of services) {
    if (!service.id) continue;
    const current = entries.get(service.id);
    if (!current || service.condition) entries.set(service.id, service);
  }
  return Array.from(entries.values());
}

function volumeYaml(caches: PreviewManifestCache[], includeWorkspace: boolean) {
  if (!includeWorkspace) return [];
  return [
    "    volumes:",
    ...(includeWorkspace ? [`      - "\${BLAME_PROJECT_ROOT}:/workspace"`] : []),
    ...caches.map(
      (cache) => `      - ${yamlString(`${cache.name}:${cache.target}`)}`,
    ),
  ];
}

function parseVersion(value: unknown): 1 {
  if (value !== 1) throw new Error("previewManifest version must be 1");
  return 1;
}

function parseConfidence(value: unknown) {
  if (typeof value !== "string" || !confidenceValues.has(value)) {
    throw new Error("previewManifest confidence is invalid");
  }
  return value as PreviewManifest["confidence"];
}

function parseProject(value: unknown): PreviewManifestProject {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("previewManifest project must be an object");
  return {
    root: optionalString(value.root, "project.root"),
    detectedStack: optionalStringArray(value.detectedStack, "project.detectedStack"),
    confidence:
      value.confidence === undefined ? undefined : parseConfidence(value.confidence),
  };
}

function parseSetupTasks(value: unknown) {
  if (!Array.isArray(value)) throw new Error("previewManifest setup must be an array");
  return value.map(parseSetupTask);
}

function parseSetupTask(value: unknown): PreviewManifestSetupTask {
  if (!isRecord(value)) throw new Error("previewManifest setup task must be an object");
  return {
    id: requiredId(value.id, "setup.id"),
    image: requiredString(value.image, "setup.image"),
    workingDir: optionalString(value.workingDir, "setup.workingDir"),
    command: requiredString(value.command, "setup.command"),
    environment: parseEnvironment(value.environment, "setup.environment"),
    dependsOn: optionalStringArray(value.dependsOn, "setup.dependsOn"),
  };
}

function parseServices(value: unknown) {
  if (!Array.isArray(value)) throw new Error("previewManifest services must be an array");
  return value.map(parseService);
}

function parseService(value: unknown): PreviewManifestService {
  if (!isRecord(value)) throw new Error("previewManifest service must be an object");
  const kind = serviceKind(value.kind);
  return {
    id: requiredId(value.id, "service.id"),
    kind,
    image: requiredString(value.image, "service.image"),
    workingDir: optionalString(value.workingDir, "service.workingDir"),
    command: optionalString(value.command, "service.command"),
    environment: parseEnvironment(value.environment, "service.environment"),
    dependsOn: optionalStringArray(value.dependsOn, "service.dependsOn"),
    preview: value.preview === undefined ? undefined : parsePreview(value.preview),
    healthcheck:
      value.healthcheck === undefined
        ? undefined
        : parseHealthcheck(value.healthcheck),
  };
}

function parsePreview(value: unknown): PreviewManifestService["preview"] {
  if (!isRecord(value)) throw new Error("previewManifest preview must be an object");
  return {
    internalPort: internalPort(value.internalPort, "preview.internalPort"),
    protocol: httpProtocol(value.protocol),
    path: pathValue(value.path, "preview.path"),
  };
}

function parseHealthcheck(value: unknown): PreviewManifestHealthcheck {
  if (!isRecord(value)) throw new Error("previewManifest healthcheck must be an object");
  if (value.type !== "http") {
    throw new Error("previewManifest healthcheck type must be http");
  }
  return {
    type: "http",
    path: pathValue(value.path, "healthcheck.path"),
    timeoutMs: timeoutMs(value.timeoutMs),
  };
}

function parseCaches(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("previewManifest caches must be an array");
  return value.map(parseCache);
}

function parseCache(value: unknown): PreviewManifestCache {
  if (!isRecord(value)) throw new Error("previewManifest cache must be an object");
  return {
    name: requiredId(value.name, "cache.name"),
    target: absolutePath(value.target, "cache.target"),
  };
}

function parseRisks(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("previewManifest risks must be an array");
  return value.map(parseRisk);
}

function parseRisk(value: unknown): PreviewManifestRisk {
  if (!isRecord(value)) throw new Error("previewManifest risk must be an object");
  if (typeof value.level !== "string" || !riskLevels.has(value.level)) {
    throw new Error("previewManifest risk level is invalid");
  }
  return {
    level: value.level as PreviewManifestRisk["level"],
    message: requiredString(value.message, "risk.message"),
  };
}

function validateSetupTask(
  task: PreviewManifestSetupTask,
  serviceIds: Set<string>,
) {
  validateCommand(task.command, `setup task ${task.id}`);
  validateImage(task.image, `setup task ${task.id}`);
  validateWorkingDir(task.workingDir);
  validateDependsOn(task.dependsOn ?? [], serviceIds, `setup task ${task.id}`);
}

function validateService(
  service: PreviewManifestService,
  serviceIds: Set<string>,
) {
  validateImage(service.image, `service ${service.id}`);
  validateWorkingDir(service.workingDir);
  validateDependsOn(service.dependsOn ?? [], serviceIds, `service ${service.id}`);
  if (service.command) validateCommand(service.command, `service ${service.id}`);
  if (service.kind !== "dependency" && !service.command) {
    throw new Error(`previewManifest service ${service.id} command is required`);
  }
  if (service.kind === "preview") {
    if (!service.preview) {
      throw new Error(`previewManifest service ${service.id} preview is required`);
    }
    if (!service.healthcheck) {
      throw new Error(`previewManifest service ${service.id} healthcheck is required`);
    }
  }
  if (service.kind !== "preview" && service.preview) {
    throw new Error(`previewManifest service ${service.id} preview is only allowed on preview services`);
  }
}

function validateCache(cache: PreviewManifestCache) {
  absolutePath(cache.target, `cache ${cache.name}`);
  rejectSensitiveMount(cache.target, `cache ${cache.name}`);
}

function validateCommand(command: string, context: string) {
  if (command.length > 4_000) {
    throw new Error(`previewManifest ${context} command is too long`);
  }
  if (unsafeCommandPatterns.some((pattern) => pattern.test(command))) {
    throw new Error(`previewManifest ${context} command is unsafe`);
  }
}

function validateImage(image: string, context: string) {
  if (image.includes("${") || image.includes("$")) {
    throw new Error(`previewManifest ${context} image must be literal`);
  }
}

function validateWorkingDir(workingDir: string | undefined) {
  if (workingDir !== undefined) absolutePath(workingDir, "workingDir");
}

function validateDependsOn(
  dependsOn: string[],
  serviceIds: Set<string>,
  context: string,
) {
  for (const id of dependsOn) {
    if (!serviceIds.has(id)) {
      throw new Error(`previewManifest ${context} depends on unknown service ${id}`);
    }
  }
}

function uniqueIds(context: string, ids: string[]) {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`previewManifest ${context} ids must be unique`);
  }
}

function serviceKind(value: unknown): PreviewManifestServiceKind {
  if (typeof value !== "string" || !serviceKinds.has(value as PreviewManifestServiceKind)) {
    throw new Error("previewManifest service kind is invalid");
  }
  return value as PreviewManifestServiceKind;
}

function internalPort(value: unknown, field: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new Error(`previewManifest ${field} is invalid`);
  }
  return value;
}

function timeoutMs(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1_000 ||
    value > 300_000
  ) {
    throw new Error("previewManifest healthcheck timeoutMs is invalid");
  }
  return value;
}

function httpProtocol(value: unknown): "http" {
  if (value !== "http") throw new Error("previewManifest protocol must be http");
  return "http";
}

function pathValue(value: unknown, field: string) {
  const path = requiredString(value, field);
  if (!path.startsWith("/") || path.includes("\n") || path.includes("\r")) {
    throw new Error(`previewManifest ${field} is invalid`);
  }
  return path;
}

function parseEnvironment(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`previewManifest ${field} must be an object`);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`previewManifest ${field} key is invalid`);
      }
      if (typeof item !== "string") {
        throw new Error(`previewManifest ${field} value must be a string`);
      }
      return [key, item];
    }),
  );
}

function optionalStringArray(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`previewManifest ${field} must be a string array`);
  }
  return value;
}

function optionalString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`previewManifest ${field} is required`);
  }
  return value.trim();
}

function requiredId(value: unknown, field: string) {
  const id = requiredString(value, field);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    throw new Error(`previewManifest ${field} is invalid`);
  }
  return id;
}

function absolutePath(value: unknown, field: string) {
  const path = requiredString(value, field);
  if (!path.startsWith("/") || path.includes("..")) {
    throw new Error(`previewManifest ${field} must be an absolute path`);
  }
  rejectSensitiveMount(path, field);
  return path;
}

function rejectSensitiveMount(path: string, field: string) {
  if (["/", "/root", "/home", "/var/run/docker.sock"].includes(path)) {
    throw new Error(`previewManifest ${field} target is unsafe`);
  }
  if (path.startsWith("/home/") || path.includes("docker.sock")) {
    throw new Error(`previewManifest ${field} target is unsafe`);
  }
}

function runsNodePackageManager(commands: string) {
  return /\b(?:(?:corepack\s+)?(?:pnpm|yarn)|npm|bun)\s+(?:install|ci|exec|run)\b/.test(
    commands,
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
