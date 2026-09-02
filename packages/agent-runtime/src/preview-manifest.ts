import {
  parsePreviewManifest as parseContractPreviewManifest,
  validatePreviewManifest as validateContractPreviewManifest,
} from "@blame/preview-contract";
import type {
  PreviewManifest,
  PreviewManifestBinding,
  PreviewManifestCache,
  PreviewManifestContainer,
  PreviewManifestEndpoint,
  PreviewManifestEnvironment,
  PreviewManifestProject,
  PreviewManifestService,
  PreviewManifestSetupTask,
} from "@blame/preview-contract";
import type { ProjectInitializationPreferences } from "./types.js";
import { commandWithNextWebpackFallback } from "./next-webpack-fallback.js";

type GeneratedInitializationArtifacts = {
  dockerCompose: string;
  setupScript: string;
};

export function parsePreviewManifest(value: unknown): PreviewManifest {
  return normalizePreviewManifest(
    parseContractPreviewManifest(
      normalizeServiceRoleReferences(normalizeRootServiceBindings(value)),
    ),
  );
}

function normalizeRootServiceBindings(value: unknown) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.services) ||
    !Array.isArray(value.bindings)
  ) {
    return value;
  }
  const consumers = value.services.filter(
    (service) => isRecord(service) && service.kind !== "dependency",
  );
  if (consumers.length !== 1) return value;
  const consumer = consumers[0]!;
  const bindings = Array.isArray(consumer.bindings)
    ? [...consumer.bindings, ...value.bindings]
    : value.bindings;
  const manifest = { ...value };
  delete manifest.bindings;
  return {
    ...manifest,
    services: value.services.map((service) =>
      service === consumer ? { ...consumer, bindings } : service,
    ),
  };
}

function normalizeServiceRoleReferences(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.services)) return value;
  const roleIds = uniqueServiceRoleIds(value.services);
  if (!Array.isArray(value.probes) || roleIds.size === 0) return value;
  return {
    ...value,
    probes: value.probes.map((probe) => normalizedProbeFrom(probe, roleIds)),
  };
}

function uniqueServiceRoleIds(services: unknown[]) {
  const idsByRole = new Map<string, string[]>();
  for (const service of services) {
    if (!isRecord(service)) continue;
    const { id, kind } = service;
    if (typeof id !== "string" || typeof kind !== "string") continue;
    idsByRole.set(kind, [...(idsByRole.get(kind) ?? []), id]);
  }
  return new Map(
    [...idsByRole].flatMap(([role, ids]) =>
      ids.length === 1 ? [[role, ids[0]!] as const] : [],
    ),
  );
}

function normalizedProbeFrom(probe: unknown, roleIds: Map<string, string>) {
  if (!isRecord(probe) || typeof probe.from !== "string") return probe;
  const serviceId = roleIds.get(probe.from);
  return serviceId ? { ...probe, from: serviceId } : probe;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function generatePreviewArtifacts(
  manifest: PreviewManifest,
  preferences?: ProjectInitializationPreferences,
): GeneratedInitializationArtifacts {
  const normalized = normalizePreviewManifestWithPreferences(
    manifest,
    preferences,
  );
  validatePreviewManifest(normalized);
  return {
    setupScript: setupScript(),
    dockerCompose: composeYaml(normalized),
  };
}

export function validatePreviewManifest(manifest: PreviewManifest) {
  validateContractPreviewManifest(manifest);
}

export function normalizePreviewManifest(
  manifest: PreviewManifest,
): PreviewManifest {
  return normalizePreviewManifestWithPreferences(manifest);
}

export function normalizePreviewManifestWithPreferences(
  manifest: PreviewManifest,
  preferences?: ProjectInitializationPreferences,
): PreviewManifest {
  const caches = normalizedCaches(manifest);
  const services = manifest.services.map((service) =>
    normalizeService(service, caches),
  );
  const normalizedServices = services.map((service) =>
    normalizeServiceBindings(
      service,
      services,
      isNuxtProject(manifest.project),
    ),
  );
  const normalized = {
    ...manifest,
    project: {
      root: manifest.project.root || ".",
      detectedStack: manifest.project.detectedStack ?? [],
      confidence: manifest.project.confidence ?? manifest.confidence,
    },
    setup: manifest.setup.map((task) => ({
      ...task,
      workingDir: task.workingDir || "/workspace",
      command: commandWithLocalCorepackShims(task.command),
      runAs: task.runAs ?? defaultSetupRunAs(task.command),
      environment: normalizedEnvironment(
        normalizedAppEnvironment({
          ...inheritedSetupTaskDatabaseEnvironment(task, normalizedServices),
          ...(task.environment ?? {}),
        }),
        caches,
      ),
      dependsOn: uniqueStrings(task.dependsOn ?? []),
    })),
    services: normalizedServices,
    caches,
    risks: manifest.risks,
  };
  return applyPreviewManifestPreferences(
    previewManifestWithNextWebpackFallback(normalized),
    preferences,
  );
}

function normalizeServiceBindings(
  service: PreviewManifestService,
  services: PreviewManifestService[],
  inferNuxtServerBindings: boolean,
) {
  const bindings = normalizedServiceBindings(
    service.bindings ?? [],
    inferNuxtServerBindings,
  );
  const serverDependencies = new Set(
    serverBindingDependencies(service, bindings),
  );
  const browserOnlyDependencies = new Set(
    bindings
      .filter(
        (binding) =>
          binding.exposure === "browser" &&
          !serverDependencies.has(binding.source.service),
      )
      .map((binding) => binding.source.service),
  );
  const environment = { ...service.environment };
  for (const binding of bindings) {
    environment[binding.target.key] = compiledBindingValue(binding, services);
  }
  return {
    ...service,
    bindings,
    environment,
    dependsOn: uniqueStrings([
      ...(service.dependsOn ?? []).filter(
        (dependency) => !browserOnlyDependencies.has(dependency),
      ),
      ...serverDependencies,
    ]),
  };
}

function normalizedServiceBindings(
  bindings: PreviewManifestBinding[],
  inferNuxtServerBindings: boolean,
) {
  if (!inferNuxtServerBindings) return bindings;
  const targetKeys = new Set(bindings.map(({ target }) => target.key));
  const inferred = bindings.flatMap((binding) => {
    const match = /^NUXT_PUBLIC_(.+)$/.exec(binding.target.key);
    if (binding.exposure !== "browser" || !match?.[1]) return [];
    const key = `NUXT_${match[1]}`;
    if (targetKeys.has(key)) return [];
    targetKeys.add(key);
    return [
      {
        ...binding,
        target: { ...binding.target, key },
        exposure: "server" as const,
      },
    ];
  });
  return [...bindings, ...inferred];
}

function serverBindingDependencies(
  service: PreviewManifestService,
  bindings: PreviewManifestBinding[],
) {
  return bindings
    .filter((binding) => binding.exposure === "server")
    .map((binding) => binding.source.service)
    .filter((sourceId) => sourceId !== service.id);
}

function compiledBindingValue(
  binding: PreviewManifestBinding,
  services: PreviewManifestService[],
) {
  const source = services.find(({ id }) => id === binding.source.service);
  const endpoint = source && serviceEndpoint(source, binding.source.endpoint);
  if (!source || !endpoint)
    throw new Error("previewManifest binding source is unknown");
  if (binding.exposure === "browser")
    return browserBindingValue(binding, endpoint);
  return serverBindingValue(binding, source.id, endpoint);
}

function browserBindingValue(
  binding: PreviewManifestBinding,
  endpoint: PreviewManifestEndpoint,
) {
  const port = `__BLAME_PREVIEW_PORT_${binding.source.service}_${endpoint.port}__`;
  const path = binding.path ?? "";
  if (binding.format === "host") return "localhost";
  if (binding.format === "port") return port;
  if (binding.format === "host-port") return `localhost:${port}`;
  return `${endpoint.protocol}://localhost:${port}${path}`;
}

function serverBindingValue(
  binding: PreviewManifestBinding,
  host: string,
  endpoint: PreviewManifestEndpoint,
) {
  if (binding.format === "host") return host;
  if (binding.format === "port") return String(endpoint.port);
  if (binding.format === "host-port") return `${host}:${endpoint.port}`;
  return `${endpoint.protocol}://${host}:${endpoint.port}${binding.path ?? ""}`;
}

function serviceEndpoint(
  service: PreviewManifestService,
  endpointId: string,
): PreviewManifestEndpoint | undefined {
  return service.endpoints.find(({ id }) => id === endpointId);
}

function previewEndpoint(service: PreviewManifestService) {
  return service.kind === "preview"
    ? service.endpoints.find(({ protocol }) => protocol !== "tcp")
    : undefined;
}

function containerImage(container: PreviewManifestContainer) {
  return container.image ?? "";
}

function previewManifestWithNextWebpackFallback(manifest: PreviewManifest) {
  if (!isNextProject(manifest.project)) return manifest;
  return {
    ...manifest,
    services: manifest.services.map((service) => ({
      ...service,
      command:
        service.kind === "preview" && service.command
          ? commandWithNextWebpackFallback(service.command)
          : service.command,
    })),
  };
}

function isNextProject(project: PreviewManifestProject) {
  return (project.detectedStack ?? []).some((stack) =>
    ["next", "nextjs", "next.js"].includes(stack.toLowerCase()),
  );
}

function isNuxtProject(project: PreviewManifestProject) {
  return (project.detectedStack ?? []).some((stack) =>
    ["nuxt", "nuxtjs", "nuxt.js"].includes(stack.toLowerCase()),
  );
}

function applyPreviewManifestPreferences(
  manifest: PreviewManifest,
  preferences: ProjectInitializationPreferences | undefined,
) {
  if (preferences?.database?.mode !== "existing") return manifest;
  return manifestWithoutComposeDatabase(manifest);
}

function manifestWithoutComposeDatabase(manifest: PreviewManifest) {
  const databaseServiceIds = new Set(
    manifest.services.filter(databaseService).map((service) => service.id),
  );
  const setup = manifest.setup
    .filter((task) => !setupTaskTouchesDatabase(task))
    .map((task) => ({
      ...task,
      environment: withoutDatabaseEnvironment(task.environment),
      dependsOn: withoutIds(task.dependsOn, databaseServiceIds),
    }));
  const removedSetupIds = new Set(
    manifest.setup
      .filter((task) => !setup.some((candidate) => candidate.id === task.id))
      .map((task) => task.id),
  );
  return {
    ...manifest,
    setup,
    services: manifest.services
      .filter((service) => !databaseServiceIds.has(service.id))
      .map((service) =>
        withoutComposeDatabaseBindings(
          service,
          new Set([...databaseServiceIds, ...removedSetupIds]),
        ),
      ),
    probes: (manifest.probes ?? []).filter(
      (probe) =>
        !databaseServiceIds.has(probe.target.service) &&
        !databaseServiceIds.has(probe.from),
    ),
  };
}

function withoutComposeDatabaseBindings(
  service: PreviewManifestService,
  blockedIds: Set<string>,
) {
  const removedBindings = (service.bindings ?? []).filter((binding) =>
    blockedIds.has(binding.source.service),
  );
  const environment = withoutDatabaseEnvironment(service.environment) ?? {};
  for (const binding of removedBindings) delete environment[binding.target.key];
  return {
    ...service,
    environment,
    bindings: (service.bindings ?? []).filter(
      (binding) => !blockedIds.has(binding.source.service),
    ),
    dependsOn: withoutIds(service.dependsOn, blockedIds),
  };
}

function databaseService(service: PreviewManifestService) {
  return (
    service.kind === "dependency" &&
    databaseImage(containerImage(service.container))
  );
}

function databaseImage(image: string) {
  return [
    /^mysql(?::|$)/,
    /\/mysql(?::|$)/,
    /^mariadb(?::|$)/,
    /\/mariadb(?::|$)/,
    /^postgres(?::|$)/,
    /\/postgres(?::|$)/,
    /^mongo(?::|$)/,
    /\/mongo(?::|$)/,
  ].some((pattern) => pattern.test(image));
}

function setupTaskTouchesDatabase(task: PreviewManifestSetupTask) {
  return /\bmigrat(?:e|ion|ions)\b/i.test(task.command);
}

function inheritedSetupTaskDatabaseEnvironment(
  task: PreviewManifestSetupTask,
  services: PreviewManifestService[],
) {
  if (!setupTaskTouchesDatabase(task)) return {};
  const workingDir = task.workingDir || "/workspace";
  const dependencyIds = new Set(task.dependsOn ?? []);
  const candidates = services
    .filter(
      (service) =>
        service.workingDir === workingDir &&
        Object.keys(service.environment ?? {}).some(databaseEnvironmentKey),
    )
    .sort(
      (left, right) =>
        sharedDependencyCount(right, dependencyIds) -
        sharedDependencyCount(left, dependencyIds),
    );
  return Object.fromEntries(
    Object.entries(candidates[0]?.environment ?? {}).filter(([key]) =>
      databaseEnvironmentKey(key),
    ),
  );
}

function sharedDependencyCount(
  service: PreviewManifestService,
  dependencyIds: Set<string>,
) {
  return (service.dependsOn ?? []).filter((id) => dependencyIds.has(id)).length;
}

function withoutDatabaseEnvironment(
  environment: PreviewManifestEnvironment | undefined,
) {
  if (!environment) return undefined;
  const next: PreviewManifestEnvironment = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!databaseEnvironmentKey(key)) next[key] = value;
  }
  return next;
}

function databaseEnvironmentKey(key: string) {
  return (
    key === "DATABASE_URL" ||
    key === "MONGO_URL" ||
    key === "MONGODB_URI" ||
    key.startsWith("DB_") ||
    key.startsWith("MYSQL_") ||
    key.startsWith("POSTGRES_") ||
    key.startsWith("PG")
  );
}

function withoutIds(ids: string[] | undefined, blockedIds: Set<string>) {
  return uniqueStrings((ids ?? []).filter((id) => !blockedIds.has(id)));
}

function normalizeService(
  service: PreviewManifestService,
  caches: PreviewManifestCache[],
): PreviewManifestService {
  const endpoint = previewEndpoint(service);
  const previewEnvironment: PreviewManifestEnvironment = endpoint
    ? {
        HOST: "0.0.0.0",
        PORT: String(endpoint.port),
      }
    : {};
  return {
    ...service,
    workingDir: service.workingDir || "/workspace",
    command: service.command
      ? commandWithLocalCorepackShims(service.command)
      : undefined,
    environment: normalizedEnvironment(
      {
        ...normalizedServiceEnvironment(service),
        ...previewEnvironment,
      },
      caches,
    ),
    dependsOn: uniqueStrings(service.dependsOn ?? []),
  };
}

function commandWithLocalCorepackShims(command: string) {
  const composeSafeCommand = escapeCorepackHomeForCompose(
    normalizePnpmScriptOptionSeparator(command),
  );
  if (
    !/\bcorepack\s+(?:pnpm|yarn)\b/.test(composeSafeCommand) ||
    composeSafeCommand.includes(
      'corepack enable --install-directory "$$COREPACK_HOME/bin"',
    )
  ) {
    return composeSafeCommand;
  }
  return [
    'mkdir -p "$$COREPACK_HOME/bin"',
    'corepack enable --install-directory "$$COREPACK_HOME/bin"',
    'export PATH="$$COREPACK_HOME/bin:$$PATH"',
    composeSafeCommand,
  ].join(" && ");
}

function normalizePnpmScriptOptionSeparator(command: string) {
  return command.replace(
    /(\b(?:corepack\s+)?pnpm\b(?:(?!&&|\|\||;).)*?\b(?:dev|start|preview|serve))\s+--\s+(?=--(?:host(?:name)?|port)\b)/g,
    "$1 ",
  );
}

function escapeCorepackHomeForCompose(command: string) {
  return command.replace(
    /(?<!\$)\$(?:COREPACK_HOME\b|\{COREPACK_HOME\})/g,
    (match) => `$${match}`,
  );
}

function normalizedServiceEnvironment(service: PreviewManifestService) {
  const environment = service.environment ?? {};
  if (
    service.kind !== "dependency" ||
    !mysqlImage(containerImage(service.container))
  ) {
    return normalizedAppEnvironment(environment);
  }
  return normalizedMysqlEnvironment(normalizedAppEnvironment(environment));
}

function normalizedMysqlEnvironment(environment: PreviewManifestEnvironment) {
  if (environment.MYSQL_USER !== "root") return environment;
  const { MYSQL_PASSWORD: password, ...rest } = environment;
  delete rest.MYSQL_USER;
  return {
    ...rest,
    MYSQL_ROOT_PASSWORD: rest.MYSQL_ROOT_PASSWORD ?? password ?? "root",
  };
}

function normalizedAppEnvironment(environment: PreviewManifestEnvironment) {
  const normalized: PreviewManifestEnvironment = {};
  for (const [key, value] of Object.entries(environment)) {
    if (key === "APP_KEY" && value.length < 16) continue;
    if (placeholderEnvironmentValue(value)) continue;
    normalized[key] = value;
  }
  return normalized;
}

function placeholderEnvironmentValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    [
      "preview",
      "placeholder",
      "preview-app-key",
      "blame-dev-app-key",
      "changeme",
      "change-me",
      "replace-me",
    ].includes(normalized) || normalized.startsWith("your_")
  );
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
  if (/\b(?:corepack\s+)?yarn\s+(?:install|run|exec)\b/.test(commands)) {
    cacheByName.set("blame_yarn_cache", {
      name: "blame_yarn_cache",
      target: "/cache/yarn",
    });
  }
  if (/\bbun\s+(?:install|run|x)\b/.test(commands)) {
    cacheByName.set("blame_bun_cache", {
      name: "blame_bun_cache",
      target: "/cache/bun",
    });
  }
  if (/\b(?:python\s+-m\s+)?pip3?\s+install\b/.test(commands)) {
    cacheByName.set("blame_pip_cache", {
      name: "blame_pip_cache",
      target: "/cache/pip",
    });
  }
  if (/\bcargo\s+(?:fetch|build|run|test)\b/.test(commands)) {
    cacheByName.set("blame_cargo_cache", {
      name: "blame_cargo_cache",
      target: "/cache/cargo",
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
    ...(byTarget.has("/npm/cache") ? { NPM_CONFIG_CACHE: "/npm/cache" } : {}),
    ...(byTarget.has("/cache/yarn")
      ? { YARN_CACHE_FOLDER: "/cache/yarn" }
      : {}),
    ...(byTarget.has("/cache/bun")
      ? { BUN_INSTALL_CACHE_DIR: "/cache/bun" }
      : {}),
    ...(byTarget.has("/cache/pip") ? { PIP_CACHE_DIR: "/cache/pip" } : {}),
    ...(byTarget.has("/cache/cargo") ? { CARGO_HOME: "/cache/cargo" } : {}),
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
  const runtimeServiceIds = new Set(
    manifest.services.map((service) => service.id),
  );
  const services = [
    ...volumeInitService(manifest.caches),
    ...manifest.setup.flatMap((task) => setupTaskYaml(task, manifest)),
    ...manifest.services.flatMap((service) =>
      serviceYaml(service, manifest, manifest.caches, runtimeServiceIds),
    ),
  ];
  const volumes = manifest.caches.flatMap((cache) => [`  ${cache.name}:`]);
  return [
    ...(services.length ? ["services:", ...services] : ["services: {}"]),
    ...(volumes.length ? ["volumes:", ...volumes] : ["volumes: {}"]),
  ].join("\n");
}

function volumeInitService(caches: PreviewManifestCache[]) {
  if (caches.length === 0) return [];
  const targets = caches.map((cache) => cache.target).join(" ");
  return [
    "  blame-volumes-init:",
    "    image: node:22-bookworm-slim",
    `    command: ${yamlString(`sh -lc "mkdir -p ${targets} && chown -R 0:0 ${targets}"`)}`,
    "    volumes:",
    ...caches.map(
      (cache) => `      - ${yamlString(`${cache.name}:${cache.target}`)}`,
    ),
  ];
}

function containerYaml(container: PreviewManifestContainer) {
  if (container.image) return [`    image: ${yamlString(container.image)}`];
  if (!container.build) {
    throw new Error("previewManifest container source is missing");
  }
  const context =
    container.build.context === "."
      ? "${BLAME_PROJECT_ROOT}"
      : `\${BLAME_PROJECT_ROOT}/${container.build.context}`;
  return [
    "    build:",
    `      context: ${yamlString(context)}`,
    `      dockerfile: ${yamlString(container.build.dockerfile)}`,
    ...(container.build.target
      ? [`      target: ${yamlString(container.build.target)}`]
      : []),
  ];
}

function entrypointYaml(entrypoint: string[] | undefined) {
  return entrypoint?.length
    ? [`    entrypoint: ${JSON.stringify(entrypoint)}`]
    : [];
}

function setupTaskYaml(
  task: PreviewManifestSetupTask,
  manifest: PreviewManifest,
) {
  const caches = manifest.caches;
  return [
    `  ${task.id}:`,
    ...containerYaml(task.container),
    ...entrypointYaml(task.entrypoint),
    `    working_dir: ${yamlString(task.workingDir ?? "/workspace")}`,
    `    command: ${yamlString(
      `sh -lc ${shellQuote(setupTaskCommand(task, manifest.services))}`,
    )}`,
    "    labels:",
    `      blame.setup: "true"`,
    ...environmentYaml(task.environment ?? {}),
    ...dependsOnYaml([
      ...(caches.length > 0
        ? [
            dependsOnEntry(
              "blame-volumes-init",
              "service_completed_successfully",
            ),
          ]
        : []),
      ...(task.dependsOn ?? []).map((id) =>
        dependsOnEntry(id, setupDependencyCondition(id, manifest)),
      ),
    ]),
    ...volumeYaml(caches, true),
  ];
}

function serviceYaml(
  service: PreviewManifestService,
  manifest: PreviewManifest,
  caches: PreviewManifestCache[],
  runtimeServiceIds: Set<string>,
) {
  return [
    `  ${service.id}:`,
    ...containerYaml(service.container),
    ...entrypointYaml(service.entrypoint),
    ...(service.user ? [`    user: ${yamlString(service.user)}`] : []),
    ...(service.kind === "dependency" && !service.command
      ? []
      : [`    working_dir: ${yamlString(service.workingDir ?? "/workspace")}`]),
    ...(service.command
      ? [
          `    command: ${yamlString(
            `sh -lc ${shellQuote(serviceCommand(service, manifest.services))}`,
          )}`,
        ]
      : []),
    ...environmentYaml(service.environment ?? {}),
    ...labelsYaml(service),
    ...portsYaml(service, manifest),
    ...serviceHealthcheckYaml(service),
    ...dependsOnYaml([
      ...(service.dependsOn ?? [])
        .filter((id) => runtimeServiceIds.has(id))
        .map((id) =>
          dependsOnEntry(id, serviceDependencyCondition(id, manifest.services)),
        ),
    ]),
    ...volumeYaml(caches, serviceNeedsWorkspace(service)),
  ];
}

function labelsYaml(service: PreviewManifestService) {
  const labels = [
    ["blame.service.id", service.id],
    ["blame.service.kind", service.kind],
    ...previewLabels(service),
    ...endpointLabels(service),
    ...bindingLabels(service),
  ];
  return [
    "    labels:",
    ...labels.map(([key, value]) => `      ${key}: ${yamlString(value)}`),
  ];
}

function previewLabels(service: PreviewManifestService) {
  const endpoint = previewEndpoint(service);
  if (!endpoint) return [];
  return [
    ["blame.preview", "true"],
    ["blame.preview.port", String(endpoint.port)],
    ["blame.preview.protocol", endpoint.protocol],
    ["blame.preview.path", endpoint.healthcheck?.path ?? "/"],
  ];
}

function endpointLabels(service: PreviewManifestService) {
  return (service.endpoints ?? []).flatMap((endpoint, index) => [
    [`blame.endpoint.${index}.id`, endpoint.id],
    [`blame.endpoint.${index}.protocol`, endpoint.protocol],
    [`blame.endpoint.${index}.port`, String(endpoint.port)],
  ]);
}

function bindingLabels(service: PreviewManifestService) {
  return (service.bindings ?? []).flatMap((binding, index) => [
    [`blame.binding.${index}.key`, binding.target.key],
    [`blame.binding.${index}.source.service`, binding.source.service],
    [`blame.binding.${index}.source.endpoint`, binding.source.endpoint],
    [`blame.binding.${index}.exposure`, binding.exposure],
    [`blame.binding.${index}.format`, binding.format ?? "url"],
  ]);
}

function serviceCommand(
  service: PreviewManifestService,
  services: PreviewManifestService[],
) {
  const waitCommands = dependencyWaitCommands(service, services);
  return [...waitCommands, service.command].filter(Boolean).join(" && ");
}

function serviceNeedsWorkspace(service: PreviewManifestService) {
  return (
    service.kind !== "dependency" ||
    (!!service.command &&
      (service.workingDir ?? "/workspace").startsWith("/workspace"))
  );
}

function dependencyWaitCommands(
  service: PreviewManifestService,
  services: PreviewManifestService[],
) {
  if (!nodeImage(containerImage(service.container))) return [];
  return (service.dependsOn ?? [])
    .map((id) => services.find((candidate) => candidate.id === id))
    .map((dependency) => dependencyWaitTarget(dependency))
    .filter((target): target is { host: string; port: number } => !!target)
    .map((target) => waitForTcpCommand(target.host, target.port));
}

function dependencyWaitTarget(service: PreviewManifestService | undefined) {
  if (!service) return undefined;
  const endpoint = (service.endpoints ?? [])[0];
  if (endpoint) return { host: service.id, port: endpoint.port };
  if (mysqlImage(containerImage(service.container))) {
    return { host: service.id, port: 3306 };
  }
  return undefined;
}

function waitForTcpCommand(host: string, port: number) {
  const script = [
    `const net=require("net")`,
    `const host=${JSON.stringify(host)}`,
    `const port=${port}`,
    `const deadline=Date.now()+60000`,
    `function retry(){const socket=net.connect(port,host,()=>process.exit(0));socket.setTimeout(1000,()=>socket.destroy());socket.once("error",next);socket.once("timeout",next)}`,
    `function next(){if(Date.now()>deadline)process.exit(1);setTimeout(retry,1000)}`,
    `retry()`,
  ].join(";");
  return `node -e ${shellQuote(script)}`;
}

function portsYaml(service: PreviewManifestService, manifest: PreviewManifest) {
  const ports = publishedServicePorts(service, manifest);
  if (ports.length === 0) return [];
  return [
    "    ports:",
    ...ports.map((port) => `      - ${yamlString(`127.0.0.1::${port}`)}`),
  ];
}

function publishedServicePorts(
  service: PreviewManifestService,
  manifest: PreviewManifest,
) {
  const endpointIds = [
    ...browserBindingEndpointIds(service.id, manifest.services),
    ...hostProbeEndpointIds(service.id, manifest),
  ];
  const endpointPorts = endpointIds.flatMap((endpointId) => {
    const endpoint = serviceEndpoint(service, endpointId);
    return endpoint ? [endpoint.port] : [];
  });
  return Array.from(
    new Set([
      ...(previewEndpoint(service) ? [previewEndpoint(service)!.port] : []),
      ...endpointPorts,
    ]),
  );
}

function browserBindingEndpointIds(
  serviceId: string,
  services: PreviewManifestService[],
) {
  return services.flatMap((consumer) =>
    (consumer.bindings ?? [])
      .filter(
        (binding) =>
          binding.exposure === "browser" &&
          binding.source.service === serviceId,
      )
      .map((binding) => binding.source.endpoint),
  );
}

function hostProbeEndpointIds(serviceId: string, manifest: PreviewManifest) {
  return (manifest.probes ?? [])
    .filter(
      (probe) => probe.from === "host" && probe.target.service === serviceId,
    )
    .map((probe) => probe.target.endpoint);
}

function serviceHealthcheckYaml(service: PreviewManifestService) {
  return (
    knownDependencyHealthcheckYaml(service) ?? declaredHealthcheckYaml(service)
  );
}

function declaredHealthcheckYaml(service: PreviewManifestService) {
  const endpoint = healthcheckEndpoint(service);
  if (!endpoint) return [];
  const command = endpointHealthcheckCommand(
    containerImage(service.container),
    endpoint,
  );
  if (!command) return [];
  const healthcheck = endpoint.healthcheck;
  if (!healthcheck) return [];
  const retries = Math.max(1, Math.ceil(healthcheck.timeoutMs / 5_000));
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

function healthcheckEndpoint(service: PreviewManifestService) {
  return service.endpoints.find(({ healthcheck }) => healthcheck);
}

function endpointHealthcheckCommand(
  image: string,
  endpoint: PreviewManifestEndpoint,
) {
  if (!endpoint.healthcheck) return undefined;
  if (nodeImage(image)) return nodeHealthcheckCommand(endpoint);
  if (pythonImage(image)) return pythonHealthcheckCommand(endpoint);
  return undefined;
}

function nodeHealthcheckCommand(endpoint: PreviewManifestEndpoint) {
  if (endpoint.healthcheck?.type === "tcp") {
    return waitForTcpHealthcheckCommand(endpoint.port);
  }
  const path = endpoint.healthcheck?.path ?? "/";
  const url = `${endpoint.protocol}://127.0.0.1:${endpoint.port}${path}`;
  const script = `fetch(${JSON.stringify(url)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`;
  return `node -e ${shellQuote(script)}`;
}

function waitForTcpHealthcheckCommand(port: number) {
  const script = `const s=require("net").connect(${port},"127.0.0.1",()=>process.exit(0));s.once("error",()=>process.exit(1));s.setTimeout(4000,()=>process.exit(1))`;
  return `node -e ${shellQuote(script)}`;
}

function pythonHealthcheckCommand(endpoint: PreviewManifestEndpoint) {
  if (endpoint.healthcheck?.type === "tcp") {
    const script = `import socket;socket.create_connection(("127.0.0.1",${endpoint.port}),4).close()`;
    return `python -c ${shellQuote(script)}`;
  }
  const path = endpoint.healthcheck?.path ?? "/";
  const url = `${endpoint.protocol}://127.0.0.1:${endpoint.port}${path}`;
  return `python -c ${shellQuote(`import urllib.request;urllib.request.urlopen(${JSON.stringify(url)},timeout=4).close()`)}`;
}

function knownDependencyHealthcheckYaml(service: PreviewManifestService) {
  if (service.kind !== "dependency") return undefined;
  if (!mysqlImage(containerImage(service.container))) return undefined;
  return [
    "    healthcheck:",
    "      test:",
    "        - CMD-SHELL",
    `        - ${yamlString(`mysqladmin ping -h 127.0.0.1 -uroot -p"$$MYSQL_ROOT_PASSWORD" --silent`)}`,
    "      interval: 5s",
    "      timeout: 5s",
    "      retries: 12",
  ];
}

function serviceDependencyCondition(
  id: string,
  services: PreviewManifestService[],
) {
  const dependency = services.find((service) => service.id === id);
  if (!dependency) return undefined;
  return serviceHasHealthcheck(dependency) ? "service_healthy" : undefined;
}

function setupDependencyCondition(id: string, manifest: PreviewManifest) {
  if (manifest.setup.some((task) => task.id === id)) {
    return "service_completed_successfully";
  }
  return serviceDependencyCondition(id, manifest.services);
}

function serviceHasHealthcheck(service: PreviewManifestService) {
  return !!serviceHealthcheckYaml(service).length;
}

function mysqlImage(image: string) {
  return /^mysql(?::|$)/.test(image) || /\/mysql(?::|$)/.test(image);
}

function nodeImage(image: string) {
  return /^node(?::|$)/.test(image) || /\/node(?::|$)/.test(image);
}

function pythonImage(image: string) {
  return /^python(?::|$)/.test(image) || /\/python(?::|$)/.test(image);
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

function dependsOnYaml(services: Array<{ condition?: string; id: string }>) {
  const uniqueServices = uniqueDependsOnEntries(services);
  if (uniqueServices.length === 0) return [];
  return [
    "    depends_on:",
    ...uniqueServices.flatMap((service) => [
      `      ${service.id}:`,
      `        condition: ${service.condition ?? "service_started"}`,
    ]),
  ];
}

function dependsOnEntry(id: string, condition?: string) {
  return { condition, id };
}

function uniqueDependsOnEntries(
  services: Array<{ condition?: string; id: string }>,
) {
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
    ...(includeWorkspace
      ? [`      - "\${BLAME_PROJECT_ROOT}:/workspace"`]
      : []),
    ...caches.map(
      (cache) => `      - ${yamlString(`${cache.name}:${cache.target}`)}`,
    ),
  ];
}

function runsNodePackageManager(commands: string) {
  return /\b(?:(?:corepack\s+)?(?:pnpm|yarn)|npm|bun)\s+(?:install|ci|exec|run)\b/.test(
    commands,
  );
}

function defaultSetupRunAs(command: string) {
  return workspacePermissionRepairCommand(command) ? "root" : "host";
}

function setupTaskRunsAsRoot(task: PreviewManifestSetupTask) {
  return task.runAs === "root";
}

function setupTaskCommand(
  task: PreviewManifestSetupTask,
  services: PreviewManifestService[],
) {
  const commands = [
    ...setupDependencyWaitCommands(task, services),
    task.command,
  ];
  if (setupTaskRunsAsRoot(task)) {
    commands.push(
      "find /workspace -maxdepth 1 \\( -name .nuxt -o -name .next -o -name .vite -o -name node_modules \\) -exec chown -R 0:0 {} +",
    );
  }
  return commands.join(" && ");
}

function setupDependencyWaitCommands(
  task: PreviewManifestSetupTask,
  services: PreviewManifestService[],
) {
  if (!nodeImage(containerImage(task.container))) return [];
  return (task.dependsOn ?? [])
    .map((id) => services.find((service) => service.id === id))
    .map(dependencyWaitTarget)
    .filter((target): target is { host: string; port: number } => !!target)
    .map((target) => waitForTcpCommand(target.host, target.port));
}

function workspacePermissionRepairCommand(command: string) {
  return (
    command.includes("/workspace") &&
    !unsafeWorkspaceOwnershipCommand(command) &&
    /\b(?:chown|chmod|rm\s+-rf)\b/.test(command) &&
    /\/workspace\/\.(?:nuxt|next|vite)\b|\/workspace\/node_modules\b/.test(
      command,
    )
  );
}

function unsafeWorkspaceOwnershipCommand(command: string) {
  return (
    /\b(?:chown|chmod)\b/.test(command) &&
    /\/workspace(?:\s|$)|\/workspace\/(?:apps|packages)(?:\s|\/|$)/.test(
      command,
    )
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
