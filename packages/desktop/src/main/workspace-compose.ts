import { createServer } from "node:net";

export function dockerComposeForPreview(compose: string, worktree: string) {
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
  );
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
      if (npmInstallTokens(options).some((token) => token === "--no-package-lock"))
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
  const portMappings = new Map<number, number>();
  for (const line of compose.split("\n")) {
    const allocated = allocatedPortLine(line);
    if (allocated) {
      const port = await freeLocalPort();
      portMappings.set(allocated.targetPort, port);
      result.push(
        `${allocated.prefix}${allocated.quote}${allocated.host}:${port}:${allocated.targetPort}${allocated.protocol}${allocated.quote}${allocated.suffix}`,
      );
      continue;
    }
    const explicit = explicitPortLine(line);
    if (explicit) portMappings.set(explicit.targetPort, explicit.hostPort);
    result.push(line);
  }
  return composeWithPreviewPublicOrigins(result.join("\n"), portMappings);
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
  portMappings: Map<number, number>,
) {
  if (portMappings.size === 0) return compose;
  return compose.replace(
    publicOriginAssignmentPattern(),
    (match, prefix: string, port: string) => {
      const hostPort = portMappings.get(Number.parseInt(port, 10));
      return hostPort ? `${prefix}http://127.0.0.1:${hostPort}` : match;
    },
  );
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
      if (commandIndent !== undefined && line.trim() && indent <= commandIndent) {
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
  return compose
    .replace(/\bcorepack\s+enable\s*&&\s*/g, "")
    .replace(/(?<!corepack)(^|[\s;&|])pnpm(?=\s)/g, "$1corepack pnpm");
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
) {
  const lines = compose.split("\n");
  const servicesLine = serviceSectionLine(lines);
  if (servicesLine === -1) return compose;
  const plan = dependencyVolumePlan(lines, servicesLine, worktree);
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
  mounts: string[];
  serviceMounts: Map<string, string[]>;
  services: string[];
};

function dependencyVolumePlan(
  lines: string[],
  servicesLine: number,
  worktree: string,
): DependencyVolumePlan {
  const serviceMounts = new Map<string, string[]>();
  const serviceIndent = /^\s*/.exec(lines[servicesLine])?.[0].length ?? 0;
  const childIndent = serviceIndent + 2;
  for (let index = servicesLine + 1; index < lines.length; index += 1) {
    const block = readServiceBlock(lines, index, childIndent);
    if (!block) continue;
    const planned = plannedServiceMounts(block.lines, worktree);
    if (planned.length) serviceMounts.set(serviceName(block.lines[0]), planned);
    index = block.end;
  }
  const mounts = uniqueStrings(Array.from(serviceMounts.values()).flat());
  return { mounts, serviceMounts, services: Array.from(serviceMounts.keys()) };
}

function plannedServiceMounts(lines: string[], worktree: string) {
  const root = mountedWorkspacePath(lines, worktree);
  if (!root || !runsNodePackageManager(lines)) return [];
  return [
    ...missingNodeModulesMount(lines, root),
    ...missingPackageCacheMounts(lines),
  ];
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

function missingNodeModulesMount(lines: string[], root: string) {
  const target = `${root.replace(/\/$/, "")}/node_modules`;
  if (mountTargetExists(lines, target)) return [];
  return [`blame_node_modules:${target}`];
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
    return mounts ? serviceBlockWithMounts(block.lines, mounts) : block.lines;
  });
}

function serviceBlockWithMounts(lines: string[], mounts: string[]) {
  const environmentLines = cacheEnvironmentLines(lines, mounts);
  const serviceLines =
    environmentLines.length > 0
      ? serviceBlockWithEnvironment(lines, environmentLines)
      : lines;
  const targetLines = serviceLines;
  const targetVolumesIndex = targetLines.findIndex((line) =>
    /^\s{4}volumes:\s*$/.test(line),
  );
  if (targetVolumesIndex === -1) {
    const [serviceLine, ...serviceBody] = targetLines;
    return [serviceLine, "    volumes:", ...mountLines(mounts), ...serviceBody];
  }
  return [
    ...targetLines.slice(0, targetVolumesIndex + 1),
    ...mountLines(mounts),
    ...targetLines.slice(targetVolumesIndex + 1),
  ];
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
    `    command: ${JSON.stringify(`sh -lc "mkdir -p ${paths.join(" ")} && chown -R 0:0 ${paths.join(" ")}"`)}`,
    "    volumes:",
    ...mounts.map((mount) => `      - ${JSON.stringify(mount)}`),
  ];
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
    return volumeLines.length > 0 ? [...lines, "volumes:", ...volumeLines] : lines;
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

function missingTopLevelVolumeLines(mounts: string[], declaredVolumes: Set<string>) {
  return uniqueStrings(mounts.map(volumeName))
    .filter((name) => !declaredVolumes.has(name))
    .flatMap(volumeYaml);
}

function volumeYaml(name: string) {
  if (name === "blame_node_modules") return [`  ${name}:`];
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
