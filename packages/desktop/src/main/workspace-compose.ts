import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export function dockerComposeForPreview(
  compose: string,
  worktree: string,
  dependencyVolumeKey = dependencyVolumeHash(compose),
) {
  const previewCompose = dockerComposeWithEscapedCommandVariables(
    projectRootCompose(compose, worktree),
  );
  return dockerComposeWithDependencyVolumes(
    dockerComposeWithCiForPackageInstalls(
      dockerComposeWithCorepackPnpm(
        dockerComposeWithHostUser(previewCompose, worktree),
      ),
    ),
    worktree,
    dependencyVolumeKey,
  );
}

export type HostFileMount = {
  containerPath: string;
  hostPath: string;
};

export function dockerComposeWithHostFileMounts(
  compose: string,
  worktree: string,
  mounts: HostFileMount[],
) {
  if (mounts.length === 0) return compose;
  const lines = compose.split("\n");
  const servicesLine = serviceSectionLine(lines);
  if (servicesLine === -1) return compose;
  return mapServiceBlocks(lines, servicesLine, (block) => {
    const root = mountedWorkspacePath(block.lines, worktree);
    if (!root) return block.lines;
    return serviceBlockWithMounts(
      block.lines,
      mounts.map(
        (mount) =>
          `${mount.hostPath}:${root.replace(/\/$/, "")}/${mount.containerPath}`,
      ),
    );
  }).join("\n");
}

export function composeWithoutNumericSuUser(compose: string) {
  return compose.replace(
    /\bsu\s+-s\s+\/bin\/bash\s+-c\s+((['"])(?:(?!\2).)+\2)\s+(['"])#\$\{BLAME_HOST_UID\}\3/g,
    "bash -lc $1",
  );
}

export function composeWithNonMutatingNpmInstalls(compose: string) {
  return compose.replace(
    /(^|[\s;&|"'`(])npm\s+install\b([^\n;&|"'`]*)/g,
    (match, prefix: string, args: string) => {
      const options = args.trim();
      if (
        npmInstallTokens(options).some((token) => token === "--no-package-lock")
      )
        return match;
      if (hasNpmInstallPackageArguments(options)) return match;
      const suffix = options ? ` ${options}` : "";
      const separator = /\s$/.test(args) ? " " : "";
      return `${prefix}npm install --no-package-lock${suffix}${separator}`;
    },
  );
}

function hasNpmInstallPackageArguments(options: string) {
  return npmInstallTokens(options).some((token, index, tokens) => {
    if (token.startsWith("-")) return false;
    return !npmOptionTakesValue(tokens[index - 1] ?? "");
  });
}

function npmInstallTokens(options: string) {
  const matches = options.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*')+/g);
  return matches ?? [];
}

function npmOptionTakesValue(option: string) {
  const name = option.split("=")[0];
  return [
    "--cache",
    "--prefix",
    "--registry",
    "--userconfig",
    "--workspace",
    "--workspace-root",
    "-w",
    "-C",
  ].includes(name);
}

export async function composeWithAllocatedHostPorts(compose: string) {
  const result: string[] = [];
  const portMappings: ComposePortMapping[] = [];
  let serviceId: string | undefined;
  for (const line of compose.split("\n")) {
    serviceId = composeServiceId(line, serviceId);
    const allocated = allocatedPortLine(line);
    if (allocated) {
      const port = await freeLocalPort();
      portMappings.push({
        hostPort: port,
        serviceId,
        targetPort: allocated.targetPort,
      });
      result.push(
        `${allocated.prefix}${allocated.quote}${allocated.host}:${port}:${allocated.targetPort}${allocated.protocol}${allocated.quote}${allocated.suffix}`,
      );
      continue;
    }
    const explicit = explicitPortLine(line);
    if (explicit) portMappings.push({ ...explicit, serviceId });
    result.push(line);
  }
  const unambiguousPorts = unambiguousPortMappings(portMappings);
  const materialized = composeWithBindingPlaceholders(
    composeWithPreviewPublicOrigins(
      result.join("\n"),
      portMappings,
      unambiguousPorts,
    ),
    portMappings,
    unambiguousPorts,
  );
  return composeWithDeclaredBrowserBindings(materialized, portMappings);
}

type ComposePortMapping = {
  hostPort: number;
  serviceId?: string;
  targetPort: number;
};

function composeServiceId(line: string, current: string | undefined) {
  if (/^services:\s*(?:#.*)?$/.test(line)) return undefined;
  if (/^\S/.test(line)) return undefined;
  const match = /^  ([A-Za-z0-9][A-Za-z0-9_.-]*):\s*(?:#.*)?$/.exec(line);
  return match?.[1] ?? current;
}

function unambiguousPortMappings(mappings: ComposePortMapping[]) {
  const candidates = new Map<number, Set<number>>();
  for (const mapping of mappings) {
    const ports = candidates.get(mapping.targetPort) ?? new Set<number>();
    ports.add(mapping.hostPort);
    candidates.set(mapping.targetPort, ports);
  }
  return new Map(
    Array.from(candidates).flatMap(([targetPort, hostPorts]) =>
      hostPorts.size === 1
        ? [[targetPort, Array.from(hostPorts)[0]] as const]
        : [],
    ),
  );
}

export function composeWithRuntimePortPlaceholders(
  compose: string,
  enabled = true,
) {
  if (!enabled) return compose;
  return compose.replace(
    /(\s*-\s*["']?)(127\.0\.0\.1|localhost):\d+:(\d+)(\/[a-z]+)?(["']?\s*(?:#.*)?)$/gm,
    (
      _match,
      prefix: string,
      host: string,
      targetPort: string,
      protocol = "",
      suffix: string,
    ) => `${prefix}${host}::${targetPort}${protocol}${suffix}`,
  );
}

function allocatedPortLine(line: string) {
  const match =
    /^(\s*-\s*)(["']?)(127\.0\.0\.1|localhost)::(\d+)(\/[a-z]+)?\2(\s*(?:#.*)?)$/.exec(
      line,
    );
  if (!match) return undefined;
  return {
    prefix: match[1],
    quote: match[2],
    host: match[3],
    targetPort: Number.parseInt(match[4], 10),
    protocol: match[5] ?? "",
    suffix: match[6],
  };
}

function explicitPortLine(line: string) {
  const match =
    /^\s*-\s*["']?(?:127\.0\.0\.1|localhost):(\d+):(\d+)(?:\/[a-z]+)?["']?\s*(?:#.*)?$/.exec(
      line,
    );
  if (!match) return undefined;
  return {
    hostPort: Number.parseInt(match[1], 10),
    targetPort: Number.parseInt(match[2], 10),
  };
}

function composeWithPreviewPublicOrigins(
  compose: string,
  portMappings: ComposePortMapping[],
  unambiguousPorts: Map<number, number>,
) {
  if (portMappings.length === 0) return compose;
  let serviceId: string | undefined;
  return compose
    .split("\n")
    .map((line) => {
      serviceId = composeServiceId(line, serviceId);
      return line.replace(
        publicOriginAssignmentPattern(),
        (match, prefix: string, port: string) => {
          const targetPort = Number.parseInt(port, 10);
          const hostPort =
            servicePort(portMappings, serviceId, targetPort) ??
            unambiguousPorts.get(targetPort);
          return hostPort ? `${prefix}http://localhost:${hostPort}` : match;
        },
      );
    })
    .join("\n");
}

function composeWithBindingPlaceholders(
  compose: string,
  portMappings: ComposePortMapping[],
  unambiguousPorts: Map<number, number>,
) {
  return compose
    .replace(
      /__BLAME_PREVIEW_ORIGIN_([A-Za-z0-9][A-Za-z0-9_.-]*)_(\d+)__/g,
      (match, serviceId: string, port: string) =>
        previewOriginPlaceholder(match, serviceId, port, portMappings),
    )
    .replace(
      /__BLAME_PREVIEW_PORT_([A-Za-z0-9][A-Za-z0-9_.-]*)_(\d+)__/g,
      (match, serviceId: string, port: string) =>
        previewPortPlaceholder(match, serviceId, port, portMappings),
    )
    .replace(/__BLAME_PREVIEW_ORIGIN_(\d+)__/g, (match, port: string) =>
      legacyPreviewOriginPlaceholder(match, port, unambiguousPorts),
    )
    .replace(/__BLAME_PREVIEW_PORT_(\d+)__/g, (match, port: string) =>
      legacyPreviewPortPlaceholder(match, port, unambiguousPorts),
    );
}

type BindingComposeService = {
  depends_on?: Record<string, { condition?: string } | string> | string[];
  environment?: Record<string, unknown> | string[];
  healthcheck?: unknown;
  labels?: Record<string, unknown> | string[];
};

const frameworkServerBindingPairs = [
  {
    browserKey: "NUXT_PUBLIC_API_BASE_URL",
    serverKey: "NUXT_API_BASE_URL",
  },
] as const;

/**
 * Migrates generated Compose artifacts whose framework server consumes the
 * same backend as browser code. Older initialization results sometimes kept
 * only the public binding, which leaves SSR/proxy requests targeting an
 * unreachable host and excludes the backend from the runtime closure.
 */
export function composeWithFrameworkServerBindings(compose: string) {
  const document = parseYaml(compose) as {
    services?: Record<string, BindingComposeService>;
  };
  const services = document.services ?? {};
  let changed = false;
  for (const [serviceId, service] of Object.entries(services)) {
    const labels = normalizedComposeEntries(service.labels);
    const environment = normalizedComposeEntries(service.environment);
    for (const pair of frameworkServerBindingPairs) {
      const browserBinding = declaredBrowserBindings(labels).find(
        ({ key }) => key === pair.browserKey,
      );
      if (!browserBinding || browserBinding.sourceService === serviceId) {
        continue;
      }
      if (declaredBindingKeys(labels).has(pair.serverKey)) continue;
      const endpoint = declaredServiceEndpoint(
        services[browserBinding.sourceService],
        browserBinding.sourceEndpoint,
      );
      if (!endpoint || endpoint.protocol === "tcp") continue;
      const current = environment[browserBinding.key];
      if (!current) continue;
      const value = materializedServerBindingValue(
        browserBinding.format,
        endpoint.protocol,
        browserBinding.sourceService,
        endpoint.port,
        current,
      );
      service.environment = composeEntriesWithValues(service.environment, {
        [pair.serverKey]: value,
      });
      const index = nextBindingIndex(labels);
      service.labels = composeEntriesWithValues(service.labels, {
        [`blame.binding.${index}.key`]: pair.serverKey,
        [`blame.binding.${index}.source.service`]: browserBinding.sourceService,
        [`blame.binding.${index}.source.endpoint`]:
          browserBinding.sourceEndpoint,
        [`blame.binding.${index}.exposure`]: "server",
        [`blame.binding.${index}.format`]: browserBinding.format,
      });
      service.depends_on = composeDependenciesWithService(
        service.depends_on,
        browserBinding.sourceService,
        Boolean(services[browserBinding.sourceService]?.healthcheck),
      );
      changed = true;
    }
  }
  return changed ? stringifyYaml(document, { lineWidth: 0 }) : compose;
}

function declaredBindingKeys(labels: Record<string, string>) {
  return new Set(
    Object.entries(labels).flatMap(([key, value]) =>
      /^blame\.binding\.\d+\.key$/.test(key) ? [value] : [],
    ),
  );
}

function nextBindingIndex(labels: Record<string, string>) {
  const indices = Object.keys(labels).flatMap((key) => {
    const match = /^blame\.binding\.(\d+)\.key$/.exec(key);
    return match ? [Number(match[1])] : [];
  });
  return indices.length ? Math.max(...indices) + 1 : 0;
}

function composeEntriesWithValues(
  entries: Record<string, unknown> | string[] | undefined,
  values: Record<string, string>,
) {
  if (!Array.isArray(entries)) return { ...(entries ?? {}), ...values };
  const keys = new Set(Object.keys(values));
  return [
    ...entries.filter((entry) => !keys.has(entry.split("=", 1)[0])),
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
  ];
}

function composeDependenciesWithService(
  dependencies:
    | Record<string, { condition?: string } | string>
    | string[]
    | undefined,
  service: string,
  healthy: boolean,
) {
  if (Array.isArray(dependencies)) {
    return dependencies.includes(service)
      ? dependencies
      : [...dependencies, service];
  }
  return {
    ...(dependencies ?? {}),
    [service]: dependencies?.[service] ?? {
      condition: healthy ? "service_healthy" : "service_started",
    },
  };
}

function composeWithDeclaredBrowserBindings(
  compose: string,
  portMappings: ComposePortMapping[],
) {
  const document = parseYaml(compose) as {
    services?: Record<string, BindingComposeService>;
  };
  const services = document.services ?? {};
  const replacements = new Map<string, Record<string, string>>();
  for (const [serviceId, service] of Object.entries(services)) {
    const labels = normalizedComposeEntries(service.labels);
    const environment = normalizedComposeEntries(service.environment);
    const values: Record<string, string> = {};
    for (const binding of declaredBrowserBindings(labels)) {
      const endpoint = declaredServiceEndpoint(
        services[binding.sourceService],
        binding.sourceEndpoint,
      );
      if (!endpoint) continue;
      const hostPort = servicePort(
        portMappings,
        binding.sourceService,
        endpoint.port,
      );
      const current = environment[binding.key];
      if (!hostPort || !current) continue;
      values[binding.key] = materializedBrowserBindingValue(
        binding.format,
        endpoint.protocol,
        hostPort,
        current,
      );
    }
    if (Object.keys(values).length) replacements.set(serviceId, values);
  }
  if (!replacements.size) return compose;
  const lines = compose.split("\n");
  const servicesLine = serviceSectionLine(lines);
  if (servicesLine === -1) return compose;
  return mapServiceBlocks(lines, servicesLine, (block) =>
    serviceBlockWithEnvironmentReplacements(
      block.lines,
      replacements.get(serviceName(block.lines[0])) ?? {},
    ),
  ).join("\n");
}

function declaredBrowserBindings(labels: Record<string, string>) {
  return Object.keys(labels).flatMap((key) => {
    const match = /^blame\.binding\.(\d+)\.key$/.exec(key);
    if (!match) return [];
    const index = match[1];
    if (labels[`blame.binding.${index}.exposure`] !== "browser") return [];
    return [
      {
        key: labels[key],
        sourceService: labels[`blame.binding.${index}.source.service`] ?? "",
        sourceEndpoint: labels[`blame.binding.${index}.source.endpoint`] ?? "",
        format: labels[`blame.binding.${index}.format`] ?? "url",
      },
    ];
  });
}

function declaredServiceEndpoint(
  service: BindingComposeService | undefined,
  endpointId: string,
) {
  const labels = normalizedComposeEntries(service?.labels);
  for (const key of Object.keys(labels)) {
    const match = /^blame\.endpoint\.(\d+)\.id$/.exec(key);
    if (!match || labels[key] !== endpointId) continue;
    const port = Number(labels[`blame.endpoint.${match[1]}.port`]);
    if (!Number.isInteger(port) || port <= 0) return undefined;
    return {
      port,
      protocol: labels[`blame.endpoint.${match[1]}.protocol`] || "http",
    };
  }
  return undefined;
}

function materializedBrowserBindingValue(
  format: string,
  protocol: string,
  hostPort: number,
  current: string,
) {
  if (format === "host") return "localhost";
  if (format === "port") return String(hostPort);
  if (format === "host-port") return `localhost:${hostPort}`;
  const suffix = /^[a-z]+:\/\/[^/]+(.*)$/i.exec(current)?.[1] ?? "";
  return `${protocol}://localhost:${hostPort}${suffix}`;
}

function materializedServerBindingValue(
  format: string,
  protocol: string,
  host: string,
  port: number,
  current: string,
) {
  if (format === "host") return host;
  if (format === "port") return String(port);
  if (format === "host-port") return `${host}:${port}`;
  const suffix = /^[a-z]+:\/\/[^/]+(.*)$/i.exec(current)?.[1] ?? "";
  return `${protocol}://${host}:${port}${suffix}`;
}

function normalizedComposeEntries(
  value: Record<string, unknown> | string[] | undefined,
) {
  if (!value) return {};
  if (!Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, String(entry)]),
    );
  }
  return Object.fromEntries(
    value.map((entry) => {
      const [key, ...parts] = entry.split("=");
      return [key, parts.join("=")];
    }),
  );
}

function serviceBlockWithEnvironmentReplacements(
  lines: string[],
  replacements: Record<string, string>,
) {
  if (!Object.keys(replacements).length) return lines;
  return lines.map((line) => {
    for (const [key, value] of Object.entries(replacements)) {
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^\\s{6}${escapedKey}:`).test(line)) {
        return `      ${key}: ${JSON.stringify(value)}`;
      }
      if (new RegExp(`^\\s{6}-\\s*${escapedKey}=`).test(line)) {
        return `      - ${key}=${value}`;
      }
    }
    return line;
  });
}

function previewOriginPlaceholder(
  fallback: string,
  serviceId: string,
  port: string,
  portMappings: ComposePortMapping[],
) {
  const hostPort = servicePort(
    portMappings,
    serviceId,
    Number.parseInt(port, 10),
  );
  return hostPort ? `http://localhost:${hostPort}` : fallback;
}

function previewPortPlaceholder(
  fallback: string,
  serviceId: string,
  port: string,
  portMappings: ComposePortMapping[],
) {
  return String(
    servicePort(portMappings, serviceId, Number.parseInt(port, 10)) ?? fallback,
  );
}

function servicePort(
  mappings: ComposePortMapping[],
  serviceId: string | undefined,
  targetPort: number,
) {
  return mappings.find(
    (mapping) =>
      mapping.serviceId === serviceId && mapping.targetPort === targetPort,
  )?.hostPort;
}

function legacyPreviewOriginPlaceholder(
  fallback: string,
  port: string,
  portMappings: Map<number, number>,
) {
  const hostPort = portMappings.get(Number.parseInt(port, 10));
  return hostPort ? `http://localhost:${hostPort}` : fallback;
}

function legacyPreviewPortPlaceholder(
  fallback: string,
  port: string,
  portMappings: Map<number, number>,
) {
  return String(portMappings.get(Number.parseInt(port, 10)) ?? fallback);
}

function publicOriginAssignmentPattern() {
  const names = [
    "APP_URL",
    "APPLICATION_URL",
    "BETTER_AUTH_URL",
    "CANONICAL_URL",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_BASE_URL",
    "NEXTAUTH_URL",
    "PUBLIC_URL",
    "SITE_URL",
  ].join("|");
  return new RegExp(
    `((?:^|[\\s-])(?:${names})(?:\\s*[:=]\\s*|=)["']?)https?:\\/\\/(?:localhost|127\\.0\\.0\\.1):(\\d+)\\b`,
    "gm",
  );
}

export function dockerComposeWithEscapedCommandVariables(compose: string) {
  const lines = compose.split("\n");
  let commandIndent: number | undefined;
  return lines
    .map((line) => {
      const indent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (
        commandIndent !== undefined &&
        line.trim() &&
        indent <= commandIndent
      ) {
        commandIndent = undefined;
      }
      if (/^\s*command:\s*/.test(line)) commandIndent = indent;
      return commandIndent === undefined ? line : escapeCommandVariables(line);
    })
    .join("\n");
}

export function dockerComposeWithHostUser(compose: string, worktree: string) {
  const lines = compose.split("\n");
  const servicesLine = serviceSectionLine(lines);
  if (servicesLine === -1) return compose;
  return addHostUserToServices(lines, servicesLine, worktree).join("\n");
}

function escapeCommandVariables(line: string) {
  return line.replace(
    /(?<!\$)\$(?:\{([a-zA-Z_][a-zA-Z0-9_]*)\}|([a-zA-Z_][a-zA-Z0-9_]*))/g,
    (value, bracedName, plainName) => {
      const name = bracedName ?? plainName;
      return name.startsWith("BLAME_") ? value : `$${value}`;
    },
  );
}

export function dockerComposeWithCorepackPnpm(compose: string) {
  const lines = compose.split("\n");
  let inCommandBlock = false;
  let commandIndent = 0;

  const resultLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return line;
    }

    const lineIndent = line.search(/\S/);
    if (inCommandBlock && lineIndent <= commandIndent) {
      inCommandBlock = false;
    }

    if (/^\s*command:\s*/.test(line)) {
      inCommandBlock = true;
      commandIndent = lineIndent;
    }

    if (inCommandBlock || /^\s*command:\s*/.test(line)) {
      let command = line;
      // Replace corepack enable && with the safe version
      command = command.replace(
        /\bcorepack\s+enable\s*&&\s*/g,
        "(corepack enable 2>/dev/null || true) && ",
      );
      // Replace bare pnpm with corepack pnpm
      command = command.replace(
        /(?<!corepack)(^|[\s;&|])pnpm(?=\s)/g,
        "$1corepack pnpm",
      );
      // Prepend corepack enable if pnpm is used but corepack enable is not in the command
      if (
        /\b(?:corepack\s+prepare\s+pnpm@|corepack\s+pnpm|pnpm)\b/.test(
          command,
        ) &&
        !/\bcorepack\s+enable\b/.test(command)
      ) {
        // Check if the command has a sh -lc wrapper (with optional backslash for nested quotes)
        const shMatch = /^(.*?\bsh\s+-lc\s+(?:\\?['"]))(.*)$/.exec(command);
        if (shMatch) {
          command = `${shMatch[1]}(corepack enable 2>/dev/null || true) && ${shMatch[2]}`;
        } else {
          // Find if the command is a list item or an inline string
          const listMatch = /^(\s*-\s*)(.*)$/.exec(command);
          if (listMatch) {
            const content = listMatch[2];
            // Check if it starts with quote
            const quoteMatch = /^(\\?['"])(.*)$/.exec(content);
            if (quoteMatch) {
              command = `${listMatch[1]}${quoteMatch[1]}(corepack enable 2>/dev/null || true) && ${quoteMatch[2]}`;
            } else {
              command = `${listMatch[1]}(corepack enable 2>/dev/null || true) && ${content}`;
            }
          } else {
            const inlineQuoteMatch = /^(\s*command:\s*\\?['"])(.*)$/.exec(
              command,
            );
            if (inlineQuoteMatch) {
              command = `${inlineQuoteMatch[1]}(corepack enable 2>/dev/null || true) && ${inlineQuoteMatch[2]}`;
            } else {
              const inlinePlainMatch = /^(\s*command:\s*)(.*)$/.exec(command);
              if (inlinePlainMatch) {
                command = `${inlinePlainMatch[1]}(corepack enable 2>/dev/null || true) && ${inlinePlainMatch[2]}`;
              }
            }
          }
        }
      }
      return command;
    }
    return line;
  });
  return resultLines.join("\n");
}

export function dockerComposeWithCiForPackageInstalls(compose: string) {
  const lines = compose.split("\n");
  const servicesLine = serviceSectionLine(lines);
  if (servicesLine === -1) return compose;
  return addCiToPackageInstallServices(lines, servicesLine).join("\n");
}

export function dockerComposeWithPortableWindowsPaths(compose: string) {
  return compose.replace(
    /([a-zA-Z]):\\([^\r\n"']*)/g,
    (_match, drive, path) => {
      return `${drive}:/${path.replace(/\\/g, "/")}`;
    },
  );
}

export function dockerComposeWithDependencyVolumes(
  compose: string,
  worktree = "",
  dependencyVolumeKey = "",
) {
  const lines = compose.split("\n");
  const servicesLine = serviceSectionLine(lines);
  if (servicesLine === -1) return compose;
  const plan = dependencyVolumePlan(
    lines,
    servicesLine,
    worktree,
    dependencyVolumeKey,
  );
  if (plan.mounts.length === 0)
    return normalizeTopLevelCacheVolumes(lines).join("\n");
  return normalizeTopLevelCacheVolumes(
    addTopLevelVolumes(
      addDependencyInitService(
        addServiceMounts(lines, servicesLine, plan),
        servicesLine,
        plan,
      ),
      plan,
    ),
  ).join("\n");
}

function serviceSectionLine(lines: string[]) {
  return lines.findIndex((line) => /^services:\s*(?:#.*)?$/.test(line));
}

function addHostUserToServices(
  lines: string[],
  servicesLine: number,
  worktree: string,
) {
  const result: string[] = [];
  const serviceIndent = /^\s*/.exec(lines[servicesLine])?.[0].length ?? 0;
  const childIndent = serviceIndent + 2;

  for (let index = 0; index < lines.length; index += 1) {
    if (
      index > servicesLine &&
      startsNextTopLevelSection(lines[index], serviceIndent)
    ) {
      result.push(...lines.slice(index));
      break;
    }
    const serviceBlock = readServiceBlock(lines, index, childIndent);
    if (!serviceBlock || index <= servicesLine) {
      result.push(lines[index]);
      continue;
    }
    result.push(...hostUserServiceBlock(serviceBlock, worktree));
    index = serviceBlock.end;
  }

  return result;
}

function addCiToPackageInstallServices(lines: string[], servicesLine: number) {
  const result: string[] = [];
  const serviceIndent = /^\s*/.exec(lines[servicesLine])?.[0].length ?? 0;
  const childIndent = serviceIndent + 2;

  for (let index = 0; index < lines.length; index += 1) {
    if (
      index > servicesLine &&
      startsNextTopLevelSection(lines[index], serviceIndent)
    ) {
      result.push(...lines.slice(index));
      break;
    }
    const serviceBlock = readServiceBlock(lines, index, childIndent);
    if (!serviceBlock || index <= servicesLine) {
      result.push(lines[index]);
      continue;
    }
    result.push(...ciServiceBlock(serviceBlock));
    index = serviceBlock.end;
  }

  return result;
}

function mapServiceBlocks(
  lines: string[],
  servicesLine: number,
  transform: (block: { lines: string[]; end: number }) => string[],
) {
  const result: string[] = [];
  const serviceIndent = /^\s*/.exec(lines[servicesLine])?.[0].length ?? 0;
  const childIndent = serviceIndent + 2;
  for (let index = 0; index < lines.length; index += 1) {
    if (
      index > servicesLine &&
      startsNextTopLevelSection(lines[index], serviceIndent)
    ) {
      result.push(...lines.slice(index));
      break;
    }
    const block = readServiceBlock(lines, index, childIndent);
    if (!block || index <= servicesLine) result.push(lines[index]);
    else {
      result.push(...transform(block));
      index = block.end;
    }
  }
  return result;
}

function readServiceBlock(lines: string[], start: number, indent: number) {
  if (!isServiceLine(lines[start], indent)) return null;
  let end = start;
  while (
    end + 1 < lines.length &&
    !startsNextTopLevelSection(lines[end + 1], indent - 2) &&
    !isServiceLine(lines[end + 1], indent)
  ) {
    end += 1;
  }
  return { lines: lines.slice(start, end + 1), end };
}

type DependencyVolumePlan = {
  key: string;
  mounts: string[];
  serviceMounts: Map<string, string[]>;
  services: string[];
};

function dependencyVolumePlan(
  lines: string[],
  servicesLine: number,
  worktree: string,
  dependencyVolumeKey: string,
): DependencyVolumePlan {
  const serviceMounts = new Map<string, string[]>();
  const serviceIndent = /^\s*/.exec(lines[servicesLine])?.[0].length ?? 0;
  const childIndent = serviceIndent + 2;
  const blocks: Array<{ lines: string[]; name: string }> = [];
  for (let index = servicesLine + 1; index < lines.length; index += 1) {
    const block = readServiceBlock(lines, index, childIndent);
    if (!block) continue;
    blocks.push({ lines: block.lines, name: serviceName(block.lines[0]) });
    index = block.end;
  }
  const packageTargets = workspacePackageNodeModulesTargets(blocks, worktree);
  for (const block of blocks) {
    const planned = plannedServiceMounts(
      block.lines,
      worktree,
      dependencyVolumeKey,
      packageTargets,
    );
    if (planned.length) serviceMounts.set(block.name, planned);
  }
  const mounts = uniqueStrings(Array.from(serviceMounts.values()).flat());
  return {
    key: dependencyVolumeKey,
    mounts,
    serviceMounts,
    services: Array.from(serviceMounts.keys()),
  };
}

function plannedServiceMounts(
  lines: string[],
  worktree: string,
  dependencyVolumeKey: string,
  packageTargets: string[],
) {
  const root = mountedWorkspacePath(lines, worktree);
  if (!root) return [];
  const nodeModulesMounts =
    runsNodePackageManager(lines) ||
    defaultNodeModulesMountExists(
      lines,
      `${root.replace(/\/$/, "")}/node_modules`,
    )
      ? nodeModulesMount(lines, root, dependencyVolumeKey)
      : [];
  const packageMounts = packageNodeModulesMounts(
    lines,
    root,
    dependencyVolumeKey,
    packageTargets,
  );
  return [
    ...nodeModulesMounts,
    ...packageMounts,
    ...(runsNodePackageManager(lines) ? missingPackageCacheMounts(lines) : []),
  ];
}

function workspacePackageNodeModulesTargets(
  blocks: Array<{ lines: string[]; name: string }>,
  worktree: string,
) {
  const targets = blocks.flatMap((block) => {
    const root = mountedWorkspacePath(block.lines, worktree);
    const workingDir = serviceWorkingDirectory(block.lines);
    if (!root || !workingDir) return [];
    const normalizedRoot = root.replace(/\/$/, "");
    const normalizedWorkingDir = workingDir.replace(/\/$/, "");
    if (!normalizedWorkingDir.startsWith(`${normalizedRoot}/`)) return [];
    return [`${normalizedWorkingDir}/node_modules`];
  });
  return uniqueStrings(targets);
}

function serviceWorkingDirectory(lines: string[]) {
  const line = lines.find((line) => /^\s{4}working_dir:\s*/.test(line));
  if (!line) return "";
  return line
    .replace(/^\s{4}working_dir:\s*/, "")
    .trim()
    .replace(/^"|"$/g, "");
}

function mountedWorkspacePath(lines: string[], worktree: string) {
  const volume = lines
    .map(shortVolumeParts)
    .find((parts) => parts?.source && projectSource(parts.source, worktree));
  return volume?.target;
}

function shortVolumeParts(line: string) {
  const match =
    /^\s*-\s*"?(?<source>[A-Za-z]:\/[^:"]+|[^":]+)"?:(?<target>"?\/[^":]+"?)(?::[^"\s]+)?\s*$/.exec(
      line,
    );
  if (!match?.groups) return null;
  return {
    source: match.groups.source,
    target: match.groups.target.replace(/^"|"$/g, ""),
  };
}

function projectSource(value: string, worktree: string) {
  return (
    [".", "$PWD", "${PWD}"].includes(value) ||
    value.startsWith("${BLAME_PROJECT_ROOT}") ||
    Boolean(
      worktree && yamlPathValue(value).startsWith(yamlPathValue(worktree)),
    )
  );
}

function nodeModulesMount(
  lines: string[],
  root: string,
  dependencyVolumeKey: string,
) {
  const target = `${root.replace(/\/$/, "")}/node_modules`;
  if (
    mountTargetExists(lines, target) &&
    !defaultNodeModulesMountExists(lines, target)
  )
    return [];
  return [
    `${nodeModulesVolumeName(dependencyVolumeKey, root, target)}:${target}`,
  ];
}

function packageNodeModulesMounts(
  lines: string[],
  root: string,
  dependencyVolumeKey: string,
  packageTargets: string[],
) {
  const targets = runsNodePackageManager(lines)
    ? packageTargets
    : servicePackageNodeModulesTargets(lines, root, packageTargets);
  return targets
    .filter((target) => !mountTargetExists(lines, target))
    .map(
      (target) =>
        `${nodeModulesVolumeName(dependencyVolumeKey, root, target)}:${target}`,
    );
}

function servicePackageNodeModulesTargets(
  lines: string[],
  root: string,
  packageTargets: string[],
) {
  const workingDir = serviceWorkingDirectory(lines).replace(/\/$/, "");
  if (!workingDir) return [];
  return packageTargets.filter(
    (target) => target === `${workingDir}/node_modules`,
  );
}

function nodeModulesVolumeName(key: string, root = "", target = "") {
  if (!key) return "blame_node_modules";
  const suffix = nodeModulesVolumeSuffix(root, target);
  return suffix
    ? `blame_node_modules_${key}_${suffix}`
    : `blame_node_modules_${key}`;
}

function nodeModulesVolumeSuffix(root: string, target: string) {
  const normalizedRoot = root.replace(/\/$/, "");
  const normalizedTarget = target.replace(/\/node_modules\/?$/, "");
  if (!normalizedRoot || normalizedTarget === normalizedRoot) return "";
  if (!normalizedTarget.startsWith(`${normalizedRoot}/`)) return "";
  return normalizedTarget
    .slice(normalizedRoot.length + 1)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function missingPackageCacheMounts(lines: string[]) {
  const service = lines.join("\n");
  return [
    ...missingCacheMount(
      service,
      /\bcorepack\s+prepare\b/,
      "blame_corepack_cache:/tmp/corepack-cache",
    ),
    ...missingPnpmStoreMount(service),
    ...missingCacheMount(
      service,
      /\bnpm\s+(?:install|ci)\b/,
      "blame_npm_cache:/npm/cache",
    ),
    ...missingCacheMount(
      service,
      /\b(?:corepack\s+)?yarn\s+install\b/,
      "blame_yarn_cache:/yarn/cache",
    ),
    ...missingCacheMount(
      service,
      /\bbun\s+install\b/,
      "blame_bun_cache:/bun/cache",
    ),
  ];
}

function missingCacheMount(service: string, command: RegExp, mount: string) {
  const target = mount.split(":")[1];
  return command.test(service) && !service.includes(`:${target}`)
    ? [mount]
    : [];
}

function missingPnpmStoreMount(service: string) {
  if (!/\bcorepack pnpm\s+(?:install|ci)\b/.test(service)) return [];
  if (/\bpnpm[-_]store:\/|:\/(?:tmp\/)?pnpm[-_]store\b/.test(service))
    return [];
  return ["blame_pnpm_store:/pnpm/store"];
}

function mountTargetExists(lines: string[], target: string) {
  return lines.some(
    (line) => line.includes(`:${target}`) || line.includes(`target: ${target}`),
  );
}

function defaultNodeModulesMountExists(lines: string[], target: string) {
  return lines.some((line) => {
    const short = shortVolumeParts(line);
    if (short?.target === target) return short.source === "blame_node_modules";
    return false;
  });
}

function runsNodePackageManager(lines: string[]) {
  return /\b(?:(?:corepack\s+)?(?:pnpm|yarn)|npm|bun)\s+(?:install|ci)\b/.test(
    lines.join("\n"),
  );
}

function addServiceMounts(
  lines: string[],
  servicesLine: number,
  plan: DependencyVolumePlan,
) {
  return mapServiceBlocks(lines, servicesLine, (block) => {
    const mounts = plan.serviceMounts.get(serviceName(block.lines[0]));
    if (!mounts) return block.lines;
    return serviceBlockWithDependencyCacheLabel(
      serviceBlockWithMounts(block.lines, mounts),
      mounts,
      plan.key,
    );
  });
}

function serviceBlockWithMounts(lines: string[], mounts: string[]) {
  const environmentLines = cacheEnvironmentLines(lines, mounts);
  const serviceLines =
    environmentLines.length > 0
      ? serviceBlockWithEnvironment(lines, environmentLines)
      : lines;
  const targetLines = serviceBlockWithoutMountTargets(
    serviceLines,
    mounts.map(mountTarget),
  );
  const targetVolumesIndex = targetLines.findIndex((line) =>
    /^\s{4}volumes:\s*$/.test(line),
  );
  if (targetVolumesIndex === -1) {
    const [serviceLine, ...serviceBody] = targetLines;
    return [serviceLine, "    volumes:", ...mountLines(mounts), ...serviceBody];
  }
  const targetVolumesEnd = serviceBlockSectionEnd(
    targetLines,
    targetVolumesIndex,
  );
  return [
    ...targetLines.slice(0, targetVolumesEnd),
    ...mountLines(mounts),
    ...targetLines.slice(targetVolumesEnd),
  ];
}

function serviceBlockWithDependencyCacheLabel(
  lines: string[],
  mounts: string[],
  key: string,
) {
  if (!key) return lines;
  if (!mounts.some((mount) => mountTarget(mount).endsWith("/node_modules")))
    return lines;
  if (!runsNodePackageManager(lines)) return lines;
  return serviceBlockWithLabels(lines, {
    "blame.dependencies.cache": "true",
    "blame.dependencies.cache.key": key,
  });
}

function serviceBlockWithLabels(
  lines: string[],
  labels: Record<string, string>,
) {
  const labelsIndex = lines.findIndex((line) => /^\s{4}labels:\s*$/.test(line));
  const missing = Object.entries(labels).filter(
    ([key]) => !labelKeyExists(lines, key),
  );
  if (missing.length === 0) return lines;
  const list = serviceUsesListLabels(lines);
  const rendered = missing.map(([key, value]) =>
    list ? `      - ${key}=${value}` : `      ${key}: ${JSON.stringify(value)}`,
  );
  if (labelsIndex === -1) {
    const [serviceLine, ...serviceBody] = lines;
    return [serviceLine, "    labels:", ...rendered, ...serviceBody];
  }
  return [
    ...lines.slice(0, labelsIndex + 1),
    ...rendered,
    ...lines.slice(labelsIndex + 1),
  ];
}

function labelKeyExists(lines: string[], key: string) {
  if (!key) return true;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return lines.some((line) =>
    new RegExp(`^\\s{6}(?:-\\s*)?${escaped}(?:=|:)`).test(line),
  );
}

function serviceUsesListLabels(lines: string[]) {
  const labelsIndex = lines.findIndex((line) => /^\s{4}labels:\s*$/.test(line));
  const next = lines
    .slice(labelsIndex + 1)
    .find((line) => line.trim() && !line.trim().startsWith("#"));
  return Boolean(next && /^\s{6}-/.test(next));
}

function serviceBlockWithoutMountTargets(lines: string[], targets: string[]) {
  const volumesIndex = lines.findIndex((line) =>
    /^\s{4}volumes:\s*$/.test(line),
  );
  if (volumesIndex === -1) return lines;
  const volumesEnd = serviceBlockSectionEnd(lines, volumesIndex);
  return [
    ...lines.slice(0, volumesIndex + 1),
    ...lines
      .slice(volumesIndex + 1, volumesEnd)
      .filter(
        (line) => !targets.some((target) => mountLineTargets(line, target)),
      ),
    ...lines.slice(volumesEnd),
  ];
}

function mountTarget(mount: string) {
  return mount.split(":").at(-1) ?? "";
}

function mountLineTargets(line: string, target: string) {
  return line.includes(`:${target}`) || line.includes(`target: ${target}`);
}

function serviceBlockSectionEnd(lines: string[], start: number) {
  const startIndent = /^\s*/.exec(lines[start])?.[0].length ?? 0;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (line.trim() && indent <= startIndent) break;
    end += 1;
  }
  return end;
}

function cacheEnvironmentLines(lines: string[], mounts: string[]) {
  const list = serviceUsesListEnvironment(lines);
  return Object.entries(cacheEnvironment(mounts))
    .filter(([key]) => !environmentKeyExists(lines, key))
    .map(([key, value]) =>
      list
        ? `      - ${key}=${value}`
        : `      ${key}: ${JSON.stringify(value)}`,
    );
}

function cacheEnvironment(mounts: string[]) {
  return {
    ...(mounts.includes("blame_pnpm_store:/pnpm/store")
      ? { npm_config_store_dir: "/pnpm/store" }
      : {}),
    ...(mounts.includes("blame_corepack_cache:/tmp/corepack-cache")
      ? { COREPACK_HOME: "/tmp/corepack-cache" }
      : {}),
    ...(mounts.includes("blame_npm_cache:/npm/cache")
      ? { NPM_CONFIG_CACHE: "/npm/cache" }
      : {}),
    ...(mounts.includes("blame_yarn_cache:/yarn/cache")
      ? { YARN_CACHE_FOLDER: "/yarn/cache" }
      : {}),
    ...(mounts.includes("blame_bun_cache:/bun/cache")
      ? { BUN_INSTALL_CACHE_DIR: "/bun/cache" }
      : {}),
  };
}

function serviceBlockWithEnvironment(lines: string[], environment: string[]) {
  const environmentIndex = lines.findIndex((line) =>
    /^\s{4}environment:\s*$/.test(line),
  );
  if (environmentIndex === -1) {
    const [serviceLine, ...serviceBody] = lines;
    return [serviceLine, "    environment:", ...environment, ...serviceBody];
  }
  return [
    ...lines.slice(0, environmentIndex + 1),
    ...environment,
    ...lines.slice(environmentIndex + 1),
  ];
}

function environmentKeyExists(lines: string[], key: string) {
  return lines.some((line) =>
    new RegExp(`^\\s{6}(?:-\\s*)?${key}(?:=|:)`).test(line),
  );
}

function serviceUsesListEnvironment(lines: string[]) {
  const environmentIndex = lines.findIndex((line) =>
    /^\s{4}environment:\s*$/.test(line),
  );
  const next = lines
    .slice(environmentIndex + 1)
    .find((line) => line.trim() && !line.trim().startsWith("#"));
  return Boolean(next && /^\s{6}-/.test(next));
}

function addDependencyInitService(
  lines: string[],
  servicesLine: number,
  plan: DependencyVolumePlan,
) {
  const service = dependencyInitService(plan.mounts);
  const result = [
    ...lines.slice(0, servicesLine + 1),
    ...service,
    ...lines.slice(servicesLine + 1),
  ];
  return addInitDependencies(result, servicesLine, plan.services);
}

function dependencyInitService(mounts: string[]) {
  const paths = mounts.map((mount) => mount.split(":")[1]);
  return [
    "  blame-dependencies-init:",
    "    image: node:22-bookworm-slim",
    `    command: ${JSON.stringify(`sh -lc '${paths.map(volumeInitCommand).join("; ")}'`)}`,
    "    volumes:",
    ...mounts.map((mount) => `      - ${JSON.stringify(mount)}`),
  ];
}

function volumeInitCommand(path: string) {
  const marker = `${path.replace(/\/$/, "")}/.blame-volume-ready`;
  return [
    `mkdir -p ${path}`,
    `[ -e ${marker} ] || { chown -R 0:0 ${path} && touch ${marker}; }`,
  ].join(" && ");
}

function mountLines(mounts: string[]) {
  return mounts.map((mount) => `      - ${JSON.stringify(mount)}`);
}

function addInitDependencies(
  lines: string[],
  servicesLine: number,
  services: string[],
) {
  return mapServiceBlocks(lines, servicesLine, (block) => {
    const name = serviceName(block.lines[0]);
    if (!services.includes(name)) return block.lines;
    return serviceBlockWithDependency(block.lines);
  });
}

function serviceBlockWithDependency(lines: string[]) {
  if (lines.some((line) => line.includes("blame-dependencies-init")))
    return lines;
  const dependsOnIndex = lines.findIndex((line) =>
    /^\s{4}depends_on:\s*$/.test(line),
  );
  if (dependsOnIndex === -1) {
    const [serviceLine, ...serviceBody] = lines;
    return [
      serviceLine,
      "    depends_on:",
      "      - blame-dependencies-init",
      ...serviceBody,
    ];
  }
  if (dependsOnUsesMapping(lines, dependsOnIndex)) {
    return [
      ...lines.slice(0, dependsOnIndex + 1),
      "      blame-dependencies-init:",
      "        condition: service_completed_successfully",
      ...lines.slice(dependsOnIndex + 1),
    ];
  }
  return [
    ...lines.slice(0, dependsOnIndex + 1),
    "      - blame-dependencies-init",
    ...lines.slice(dependsOnIndex + 1),
  ];
}

function dependsOnUsesMapping(lines: string[], dependsOnIndex: number) {
  const next = lines
    .slice(dependsOnIndex + 1)
    .find((line) => line.trim() && !line.trim().startsWith("#"));
  return Boolean(next && /^\s{6}[a-zA-Z0-9_.-]+:\s*$/.test(next));
}

function addTopLevelVolumes(lines: string[], plan: DependencyVolumePlan) {
  const volumesLine = lines.findIndex((line) => /^volumes:\s*$/.test(line));
  const declaredVolumes = topLevelVolumeNames(lines, volumesLine);
  const volumeLines = missingTopLevelVolumeLines(plan.mounts, declaredVolumes);
  if (volumesLine === -1)
    return volumeLines.length > 0
      ? [...lines, "volumes:", ...volumeLines]
      : lines;
  return [
    ...lines.slice(0, volumesLine + 1),
    ...volumeLines,
    ...lines.slice(volumesLine + 1),
  ];
}

function topLevelVolumeNames(lines: string[], volumesLine: number) {
  if (volumesLine === -1) return new Set<string>();
  const names = new Set<string>();
  for (let index = volumesLine + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) break;
    const match = /^\s{2}([a-zA-Z0-9_.-]+):\s*$/.exec(lines[index]);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

function normalizeTopLevelCacheVolumes(lines: string[]) {
  const volumesLine = lines.findIndex((line) => /^volumes:\s*$/.test(line));
  if (volumesLine === -1) return lines;
  const result = [...lines];
  for (let index = volumesLine + 1; index < result.length; index += 1) {
    if (/^\S/.test(result[index])) break;
    const match = /^\s{2}([a-zA-Z0-9_.-]+):\s*$/.exec(result[index]);
    if (!match) continue;
    const name = globalCacheVolumeName(match[1]);
    if (!name) continue;
    const nameLine = volumeBlockNameLine(result, index);
    if (nameLine === -1) {
      result.splice(index + 1, 0, `    name: ${name}`, "    external: true");
      index += 2;
      continue;
    }
    result[nameLine] = `    name: ${name}`;
    if (!volumeBlockExternal(result, index)) {
      result.splice(nameLine + 1, 0, "    external: true");
      index += 1;
    }
  }
  return result;
}

function volumeBlockNameLine(lines: string[], volumeLine: number) {
  for (let index = volumeLine + 1; index < lines.length; index += 1) {
    if (
      /^\s{2}[a-zA-Z0-9_.-]+:\s*$/.test(lines[index]) ||
      /^\S/.test(lines[index])
    )
      return -1;
    if (/^\s{4}name:\s*/.test(lines[index])) return index;
  }
  return -1;
}

function volumeBlockExternal(lines: string[], volumeLine: number) {
  for (let index = volumeLine + 1; index < lines.length; index += 1) {
    if (
      /^\s{2}[a-zA-Z0-9_.-]+:\s*$/.test(lines[index]) ||
      /^\S/.test(lines[index])
    )
      return false;
    if (/^\s{4}external:\s*true\s*$/.test(lines[index])) return true;
  }
  return false;
}

function globalCacheVolumeName(name: string) {
  const normalized = name.replace(/-/g, "_");
  if (normalized.includes("corepack_cache")) return "blame_corepack_cache";
  if (normalized.includes("pnpm_store")) return "blame_pnpm_store";
  if (normalized.includes("pnpm_cache")) return "blame_pnpm_cache";
  if (normalized.includes("npm_cache")) return "blame_npm_cache";
  if (normalized.includes("yarn_cache")) return "blame_yarn_cache";
  if (normalized.includes("bun_cache")) return "blame_bun_cache";
  if (normalized.includes("package_store")) return "blame_package_store";
  return "";
}

function topLevelVolumeLines(mounts: string[]) {
  return ["volumes:", ...missingTopLevelVolumeLines(mounts, new Set())];
}

function missingTopLevelVolumeLines(
  mounts: string[],
  declaredVolumes: Set<string>,
) {
  return uniqueStrings(mounts.map(volumeName))
    .filter((name) => !declaredVolumes.has(name))
    .flatMap(volumeYaml);
}

function volumeYaml(name: string) {
  if (name === "blame_node_modules") return [`  ${name}:`];
  if (name.startsWith("blame_node_modules_"))
    return [`  ${name}:`, `    name: ${name}`];
  return [`  ${name}:`, `    name: ${name}`, "    external: true"];
}

function serviceName(line: string) {
  return line.trim().replace(/:.*$/, "");
}

function volumeName(mount: string) {
  return mount.split(":")[0];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

export function dependencyVolumeHash(compose: string) {
  return createHash("sha256")
    .update(compose.replace(/\$\{BLAME_PROJECT_ROOT\}/g, ""))
    .digest("hex")
    .slice(0, 12);
}

function startsNextTopLevelSection(line: string, indent: number) {
  if (!line.trim() || line.trim().startsWith("#")) return false;
  return new RegExp(`^\\s{0,${indent}}\\S`).test(line);
}

function isServiceLine(line: string, indent: number) {
  return new RegExp(`^\\s{${indent}}[a-zA-Z0-9_.-]+:\\s*(?:#.*)?$`).test(line);
}

function hostUserServiceBlock(
  block: { lines: string[]; end: number },
  worktree: string,
) {
  void worktree;
  return block.lines;
}

function ciServiceBlock(block: { lines: string[]; end: number }) {
  if (!runsPackageInstall(block.lines)) return block.lines;
  if (hasCiEnvironment(block.lines)) return block.lines;
  const environmentIndex = block.lines.findIndex((line) =>
    /^\s{4}environment:\s*(?:#.*)?$/.test(line),
  );
  if (environmentIndex === -1) {
    const [serviceLine, ...serviceBody] = block.lines;
    return [
      serviceLine,
      "    environment:",
      '      CI: "true"',
      ...serviceBody,
    ];
  }
  return [
    ...block.lines.slice(0, environmentIndex + 1),
    ciEnvironmentLine(block.lines, environmentIndex),
    ...block.lines.slice(environmentIndex + 1),
  ];
}

function runsPackageInstall(lines: string[]) {
  return /\b(?:pnpm|npm|yarn|bun)\s+(?:install|ci)\b/.test(lines.join("\n"));
}

function hasCiEnvironment(lines: string[]) {
  return lines.some((line) => /^\s{6}(?:CI:|-\s*CI=)/.test(line));
}

function ciEnvironmentLine(lines: string[], environmentIndex: number) {
  const nextEnvironmentValue = lines
    .slice(environmentIndex + 1)
    .find((line) => line.trim() && !line.trim().startsWith("#"));
  if (nextEnvironmentValue && /^\s{6}-/.test(nextEnvironmentValue))
    return "      - CI=true";
  return '      CI: "true"';
}

function projectRootCompose(compose: string, worktree: string) {
  return dockerComposeWithPortableWindowsPaths(
    compose.replace(/\$\{BLAME_PROJECT_ROOT\}/g, worktree),
  );
}

function yamlPathValue(path: string) {
  return path.replace(/\\/g, "/");
}

function freeLocalPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate local port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
