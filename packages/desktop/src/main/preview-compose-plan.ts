export type PreviewComposeService = {
  command?: string | string[];
  depends_on?: Record<string, { condition?: string } | string> | string[];
  environment?: Record<string, string> | string[];
  healthcheck?: {
    test?: string | string[];
  };
  image?: string;
  labels?: Record<string, string> | string[];
  ports?: Array<{
    mode?: string;
    protocol?: string;
    published?: string | number;
    target?: string | number;
  }>;
  volumes?: Array<
    | string
    | {
        source?: string;
        target?: string;
        type?: string;
      }
  >;
  working_dir?: string;
};

export type PreviewComposeConfig = {
  services?: Record<string, PreviewComposeService>;
};

export type PreviewComposePlan = {
  oneShotDependencies: string[];
  runtimeServices: string[];
  setupRuntimeDependencies: string[];
  setupTasks: string[];
};

export function previewComposePlan(
  config: PreviewComposeConfig,
): PreviewComposePlan {
  const services = config.services ?? {};
  const setupTasks = Object.keys(services).filter((id) =>
    setupService(services[id]),
  );
  const setupTaskSet = new Set(setupTasks);
  const runtimeServiceSet = new Set(
    Object.keys(services).filter((id) => {
      if (setupTaskSet.has(id)) return false;
      return !oneShotService(id, services, setupTaskSet);
    }),
  );
  const oneShotDependencies = sortByDependencies(
    Object.keys(services).filter(
      (id) => !setupTaskSet.has(id) && !runtimeServiceSet.has(id),
    ),
    services,
  );

  return {
    oneShotDependencies,
    runtimeServices: Array.from(runtimeServiceSet),
    setupRuntimeDependencies: setupRuntimeDependencyIds(
      setupTasks,
      runtimeServiceSet,
      services,
    ),
    setupTasks: sortByDependencies(setupTasks, services),
  };
}

export function composeRuntimeServiceClosure(
  config: PreviewComposeConfig,
  initialServices: string[],
) {
  const services = config.services ?? {};
  const runtimeServices = new Set(previewComposePlan(config).runtimeServices);
  const selected = new Set<string>();
  const pending = [...initialServices];
  while (pending.length) {
    const service = pending.shift();
    if (!service || selected.has(service) || !runtimeServices.has(service)) {
      continue;
    }
    selected.add(service);
    pending.push(...serviceDependencyIds(services[service]));
  }
  return sortByDependencies(Array.from(selected), services);
}

export function composeServiceHealthcheckCommand(
  service: PreviewComposeService | undefined,
) {
  const test = service?.healthcheck?.test;
  if (typeof test === "string" && test.trim()) {
    return ["sh", "-lc", test];
  }
  if (!Array.isArray(test) || test.length === 0) return undefined;
  const [kind, ...command] = test;
  if (kind === "NONE") return undefined;
  if (kind === "CMD-SHELL") {
    const shellCommand = command.join(" ").trim();
    return shellCommand ? ["sh", "-lc", shellCommand] : undefined;
  }
  if (kind === "CMD") return command.length ? command : undefined;
  return test;
}

export function composeSetupTaskEnvironment(
  config: PreviewComposeConfig,
  setupTaskId: string,
) {
  const services = config.services ?? {};
  const setupTask = services[setupTaskId];
  if (!setupTask || !migrationCommand(setupTask.command)) return {};
  const dependencies = new Set(serviceDependencyIds(setupTask));
  const candidate = Object.values(services)
    .filter(
      (service) =>
        runtimeService(service) &&
        service.working_dir === setupTask.working_dir &&
        Object.keys(serviceEnvironment(service)).some(databaseEnvironmentKey),
    )
    .sort(
      (left, right) =>
        sharedDependencyCount(right, dependencies) -
        sharedDependencyCount(left, dependencies),
    )[0];
  const inherited = databaseEnvironment(serviceEnvironment(candidate));
  const explicit = databaseEnvironment(serviceEnvironment(setupTask));
  return { ...inherited, ...explicit };
}

function setupRuntimeDependencyIds(
  setupTasks: string[],
  runtimeServices: Set<string>,
  services: Record<string, PreviewComposeService>,
) {
  const dependencies = new Set<string>();
  const pending = setupTasks.flatMap((id) =>
    serviceDependencyIds(services[id]),
  );
  while (pending.length) {
    const dependency = pending.shift();
    if (!dependency || dependencies.has(dependency)) continue;
    if (!runtimeServices.has(dependency)) continue;
    dependencies.add(dependency);
    pending.push(...serviceDependencyIds(services[dependency]));
  }
  return sortByDependencies(Array.from(dependencies), services);
}

function oneShotService(
  id: string,
  services: Record<string, PreviewComposeService>,
  setupTasks: Set<string>,
) {
  if (runtimeService(services[id])) return false;
  return Object.values(services).some((service) => {
    const dependency = dependencyCondition(service, id);
    return (
      dependency === "service_completed_successfully" && !setupTasks.has(id)
    );
  });
}

function runtimeService(service: PreviewComposeService | undefined) {
  const labels = serviceLabels(service);
  return Boolean(labels["blame.service.id"] || labels["blame.service.kind"]);
}

function serviceEnvironment(service: PreviewComposeService | undefined) {
  if (!service?.environment) return {};
  if (!Array.isArray(service.environment)) return service.environment;
  return Object.fromEntries(
    service.environment.map((entry) => {
      const [key, ...value] = entry.split("=");
      return [key, value.join("=")];
    }),
  );
}

function databaseEnvironment(environment: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => databaseEnvironmentKey(key)),
  );
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

function migrationCommand(command: string | string[] | undefined) {
  const value = Array.isArray(command) ? command.join(" ") : (command ?? "");
  return /\bmigrat(?:e|ion|ions)\b/i.test(value);
}

function sharedDependencyCount(
  service: PreviewComposeService,
  dependencyIds: Set<string>,
) {
  return serviceDependencyIds(service).filter((id) => dependencyIds.has(id))
    .length;
}

function setupService(service: PreviewComposeService | undefined) {
  return serviceLabels(service)["blame.setup"] === "true";
}

function serviceLabels(service: PreviewComposeService | undefined) {
  if (!service?.labels) return {};
  if (!Array.isArray(service.labels)) return service.labels;
  return Object.fromEntries(
    service.labels
      .map((label) => label.split("=", 2))
      .filter(([key]) => Boolean(key))
      .map(([key, value]) => [key, value ?? "true"]),
  );
}

function sortByDependencies(
  ids: string[],
  services: Record<string, PreviewComposeService>,
) {
  const selected = new Set(ids);
  const sorted: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    for (const dependency of serviceDependencyIds(services[id])) {
      if (selected.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  };
  for (const id of ids) visit(id);
  return sorted;
}

function serviceDependencyIds(service: PreviewComposeService | undefined) {
  if (!service?.depends_on) return [];
  return Array.isArray(service.depends_on)
    ? service.depends_on
    : Object.keys(service.depends_on);
}

function dependencyCondition(
  service: PreviewComposeService,
  dependencyId: string,
) {
  if (!service.depends_on || Array.isArray(service.depends_on))
    return undefined;
  const dependency = service.depends_on[dependencyId];
  return typeof dependency === "object" ? dependency.condition : undefined;
}
