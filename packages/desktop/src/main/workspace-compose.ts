export function dockerComposeForPreview(compose: string, worktree: string) {
  const previewCompose = projectRootCompose(compose, worktree);
  return dockerComposeWithCiForPackageInstalls(
    dockerComposeWithCorepackPnpm(
      dockerComposeWithHostUser(previewCompose, worktree),
    ),
  );
}

export function dockerComposeWithHostUser(compose: string, worktree: string) {
  const lines = compose.split("\n");
  const servicesLine = serviceSectionLine(lines);
  if (servicesLine === -1) return compose;
  return addHostUserToServices(lines, servicesLine, worktree).join("\n");
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
  if (block.lines.some((line) => /^\s{4}user:\s*/.test(line)))
    return block.lines;
  if (!mountsWorktree(block.lines, worktree)) return block.lines;
  const [serviceLine, ...serviceBody] = block.lines;
  return [
    serviceLine,
    '    user: "${BLAME_HOST_UID}:${BLAME_HOST_GID}"',
    ...serviceBody,
  ];
}

function ciServiceBlock(block: { lines: string[]; end: number }) {
  if (!runsPackageInstall(block.lines)) return block.lines;
  if (hasCiEnvironment(block.lines)) return block.lines;
  const environmentIndex = block.lines.findIndex((line) =>
    /^\s{4}environment:\s*(?:#.*)?$/.test(line),
  );
  if (environmentIndex === -1) {
    const [serviceLine, ...serviceBody] = block.lines;
    return [serviceLine, "    environment:", '      CI: "true"', ...serviceBody];
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

function mountsWorktree(lines: string[], worktree: string) {
  const service = lines.join("\n");
  const escapedWorktree = escapeRegExp(worktree);
  const escapedYamlWorktree = escapeRegExp(yamlPathValue(worktree));
  return (
    /(^|\n)\s*-\s*(?:\.|\$PWD|\$\{PWD\})(?:\/[^:]*)?:/.test(service) ||
    /(^|\n)\s*-\s*\$\{BLAME_PROJECT_ROOT\}(?:\/[^:]*)?:/.test(service) ||
    /source:\s*(?:\.|\$PWD|\$\{PWD\})/.test(service) ||
    /source:\s*\$\{BLAME_PROJECT_ROOT\}/.test(service) ||
    new RegExp(`(^|\\n)\\s*-\\s*${escapedWorktree}(?:\\/[^:]*)?:`).test(
      service,
    ) ||
    new RegExp(`source:\\s*${escapedWorktree}`).test(service) ||
    new RegExp(`(^|\\n)\\s*-\\s*${escapedYamlWorktree}(?:\\/[^:]*)?:`).test(
      service,
    ) ||
    new RegExp(`source:\\s*${escapedYamlWorktree}`).test(service)
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function projectRootCompose(compose: string, worktree: string) {
  return compose.replace(/\$\{BLAME_PROJECT_ROOT\}/g, yamlPathValue(worktree));
}

function yamlPathValue(path: string) {
  return path.replace(/\\/g, "/");
}
