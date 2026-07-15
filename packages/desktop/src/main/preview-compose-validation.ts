import { parse as parseYaml } from "yaml";

type ComposeService = {
  command?: string | string[];
  depends_on?: Record<string, unknown> | string[];
  environment?: Record<string, unknown> | string[];
  labels?: Record<string, unknown> | string[];
  ports?: Array<string | { target?: number | string }>;
  working_dir?: string;
};

type ComposeDocument = {
  services?: Record<string, ComposeService>;
};

type BindingDescriptor = {
  exposure: string;
  format: string;
  key: string;
  sourceService: string;
};

export type PreviewComposeEnvOverride = {
  directory: string;
  localHosts?: Record<string, string>;
  values: Record<string, string>;
};

export function validatePreviewComposeBindings(compose: string) {
  if (/__BLAME_PREVIEW_(?:ORIGIN|PORT)_[A-Za-z0-9_.-]+__/.test(compose)) {
    throw new Error("Preview compose contains an unresolved browser binding");
  }
  const document = parseYaml(compose) as ComposeDocument;
  const services = document.services ?? {};
  for (const [serviceId, service] of Object.entries(services)) {
    validateServiceBindings(serviceId, service, services);
  }
}

export function previewComposeEnvOverrides(compose: string) {
  const document = parseYaml(compose) as ComposeDocument;
  const services = document.services ?? {};
  const overrides = new Map<string, Record<string, string>>();
  const localHosts = new Map<string, Record<string, string>>();
  for (const service of Object.values(services)) {
    addServiceEnvOverrides(
      service,
      overrides,
      localHosts,
      legacyServiceHosts(service, services),
    );
  }
  return Array.from(new Set([...overrides.keys(), ...localHosts.keys()])).map(
    (directory) => ({
      directory,
      values: nonConflictingValues(overrides.get(directory)),
      localHosts: localHosts.get(directory),
    }),
  );
}

function addServiceEnvOverrides(
  service: ComposeService,
  overrides: Map<string, Record<string, string>>,
  localHostsByDirectory: Map<string, Record<string, string>>,
  localHosts: Record<string, string>,
) {
  const directory = workspaceDirectory(service.working_dir);
  if (!directory) return;
  const environment = normalizedEntries(service.environment);
  const bindings = bindingDescriptors(normalizedEntries(service.labels));
  const values = overrides.get(directory) ?? {};
  for (const binding of bindings) {
    const value = environment[binding.key];
    if (!value) continue;
    if (binding.key in values && values[binding.key] !== value) {
      values[binding.key] = "";
      continue;
    }
    values[binding.key] = value;
  }
  if (Object.keys(values).length > 0) overrides.set(directory, values);
  if (Object.keys(localHosts).length > 0) {
    localHostsByDirectory.set(
      directory,
      mergedLocalHosts(localHostsByDirectory.get(directory), localHosts),
    );
  }
}

function nonConflictingValues(values: Record<string, string> | undefined) {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([, value]) => Boolean(value)),
  );
}

function mergedLocalHosts(
  current: Record<string, string> | undefined,
  incoming: Record<string, string>,
) {
  const merged = { ...current };
  for (const [port, serviceId] of Object.entries(incoming)) {
    if (!(port in merged)) merged[port] = serviceId;
    else if (merged[port] !== serviceId) merged[port] = "";
  }
  return merged;
}

function legacyServiceHosts(
  consumer: ComposeService,
  services: Record<string, ComposeService>,
) {
  const candidates = new Map<string, Set<string>>();
  addReferencedServiceHosts(candidates, consumer, services);
  for (const serviceId of dependencyIds(consumer)) {
    for (const port of servicePorts(services[serviceId])) {
      addHostCandidate(candidates, port, serviceId);
    }
  }
  for (const port of servicePorts(consumer)) candidates.delete(port);
  return Object.fromEntries(
    Array.from(candidates).flatMap(([port, serviceIds]) =>
      serviceIds.size === 1 ? [[port, Array.from(serviceIds)[0]]] : [],
    ),
  );
}

function addReferencedServiceHosts(
  candidates: Map<string, Set<string>>,
  consumer: ComposeService,
  services: Record<string, ComposeService>,
) {
  for (const value of Object.values(normalizedEntries(consumer.environment))) {
    const url = parsedUrl(value);
    if (url?.port && services[url.hostname]) {
      addHostCandidate(candidates, url.port, url.hostname);
    }
  }
}

function dependencyIds(service: ComposeService) {
  if (Array.isArray(service.depends_on)) return service.depends_on;
  return Object.keys(service.depends_on ?? {});
}

function servicePorts(service: ComposeService | undefined) {
  if (!service) return [];
  const labels = normalizedEntries(service.labels);
  const environment = normalizedEntries(service.environment);
  const labelPorts = Object.entries(labels).flatMap(([key, value]) =>
    /^(?:blame\.preview\.port|blame\.endpoint\.\d+\.port)$/.test(key)
      ? validPortValues(value)
      : [],
  );
  const environmentPorts = validPortValues(environment.PORT);
  const publishedPorts = (service.ports ?? []).flatMap(composeTargetPort);
  const commandPorts = commandPortValues(service.command);
  return Array.from(
    new Set([
      ...labelPorts,
      ...environmentPorts,
      ...publishedPorts,
      ...commandPorts,
    ]),
  );
}

function composeTargetPort(value: string | { target?: number | string }) {
  if (typeof value !== "string") return validPortValues(value.target);
  const target = value
    .replace(/\/\w+$/, "")
    .split(":")
    .at(-1);
  return validPortValues(target);
}

function commandPortValues(command: string | string[] | undefined) {
  const value = Array.isArray(command) ? command.join(" ") : (command ?? "");
  return Array.from(value.matchAll(/--port(?:=|\s+)(\d{1,5})\b/g)).flatMap(
    (match) => validPortValues(match[1]),
  );
}

function validPortValues(value: unknown) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? [String(port)]
    : [];
}

function addHostCandidate(
  candidates: Map<string, Set<string>>,
  port: string,
  serviceId: string,
) {
  const services = candidates.get(port) ?? new Set<string>();
  services.add(serviceId);
  candidates.set(port, services);
}

function workspaceDirectory(workingDirectory: string | undefined) {
  if (workingDirectory === "/workspace") return ".";
  if (!workingDirectory?.startsWith("/workspace/")) return undefined;
  return workingDirectory.slice("/workspace/".length).replace(/\/+$/g, "");
}

function validateServiceBindings(
  serviceId: string,
  service: ComposeService,
  services: Record<string, ComposeService>,
) {
  const labels = normalizedEntries(service.labels);
  const environment = normalizedEntries(service.environment);
  for (const binding of bindingDescriptors(labels)) {
    if (!services[binding.sourceService]) {
      throw bindingError(
        serviceId,
        binding.key,
        "references an unknown service",
      );
    }
    const value = environment[binding.key];
    if (!value)
      throw bindingError(serviceId, binding.key, "has no effective value");
    validateBindingValue(serviceId, binding, value);
  }
}

function bindingDescriptors(labels: Record<string, string>) {
  const indexes = Object.keys(labels).flatMap((key) => {
    const match = /^blame\.binding\.(\d+)\.key$/.exec(key);
    return match ? [Number(match[1])] : [];
  });
  return indexes.map((index) => ({
    key: labels[`blame.binding.${index}.key`] ?? "",
    sourceService: labels[`blame.binding.${index}.source.service`] ?? "",
    exposure: labels[`blame.binding.${index}.exposure`] ?? "",
    format: labels[`blame.binding.${index}.format`] ?? "url",
  }));
}

function validateBindingValue(
  serviceId: string,
  binding: BindingDescriptor,
  value: string,
) {
  const valid =
    binding.exposure === "server"
      ? validServerBinding(binding, value)
      : validBrowserBinding(binding.format, value);
  if (!valid) {
    throw bindingError(
      serviceId,
      binding.key,
      "does not match its declared topology",
    );
  }
}

function validServerBinding(binding: BindingDescriptor, value: string) {
  if (binding.format === "host") return value === binding.sourceService;
  if (binding.format === "port") return validPort(value);
  if (binding.format === "host-port") {
    return (
      value.startsWith(`${binding.sourceService}:`) &&
      validPort(value.split(":").at(-1))
    );
  }
  return parsedUrl(value)?.hostname === binding.sourceService;
}

function validBrowserBinding(format: string, value: string) {
  if (format === "host") return localHost(value);
  if (format === "port") return validPort(value);
  if (format === "host-port") {
    const [host, port] = value.split(":");
    return localHost(host) && validPort(port);
  }
  const url = parsedUrl(value);
  return Boolean(url && localHost(url.hostname) && validPort(url.port));
}

function normalizedEntries(
  value: Record<string, unknown> | string[] | undefined,
): Record<string, string> {
  if (!value) return {};
  if (!Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, String(entry)]),
    );
  }
  return Object.fromEntries(value.map(environmentListEntry));
}

function environmentListEntry(entry: string) {
  const separator = entry.indexOf("=");
  return separator < 0
    ? [entry, ""]
    : [entry.slice(0, separator), entry.slice(separator + 1)];
}

function parsedUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function validPort(value: string | undefined) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535;
}

function localHost(value: string | undefined) {
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function bindingError(serviceId: string, key: string, reason: string) {
  return new Error(`Preview binding ${serviceId}.${key} ${reason}`);
}
