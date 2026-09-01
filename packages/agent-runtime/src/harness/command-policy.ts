export const blockedCommandParts = [
  "rm -rf",
  "sudo",
  "curl | sh",
  "wget | sh",
  "> /dev/",
];

export function blockedCommandReason(command: string) {
  const normalized = command.toLocaleLowerCase();
  if (dependencyInternals.test(normalized))
    return "Dependency internals are excluded from inspection. Use project manifests, declared types, and validation diagnostics.";
  if (managedInfrastructure.test(normalized))
    return "Managed preview infrastructure cannot be started from run_task.";
  if (longRunningProcess.test(normalized) || backgroundProcess.test(normalized))
    return "Long-running processes must use the managed preview runtime.";
  if (
    filesystemMutation.test(normalized) ||
    inPlaceMutation.test(normalized) ||
    packageManagerMutation.test(normalized) ||
    writesThroughInterpreter(normalized)
  )
    return "Filesystem writes must use edit_code or the dependency operation.";
  if (mutatingRedirection(normalized))
    return "Shell redirection cannot write files; use edit_code.";
  if (deniedGitCommand(normalized))
    return "Git mutations are unavailable from run_task.";
  if (elevatedOrRemoteScript.test(normalized))
    return "The command is denied by the shell safety policy.";
  return undefined;
}

const dependencyInternals =
  /(?:^|[\s'"`])(?:\.\/)?[^\s'"`]*node_modules(?:\/|\b)/u;
const managedInfrastructure =
  /(?:^|[;&|]\s*|\s)(?:docker|docker-compose|nerdctl|podman|postgres|pg_ctl|createdb|initdb)(?:\s|$)/u;
const longRunningProcess =
  /(?:^|[;&|]\s*|\s)(?:next\s+(?:dev|start)|vite(?:\s|$)|playwright\s+install|pnpm\s+(?:run\s+)?(?:dev|preview|start|serve|watch)|npm\s+(?:run\s+)?(?:dev|preview|start|serve|watch)|yarn\s+(?:dev|preview|start|serve|watch)|bun\s+(?:run\s+)?(?:dev|preview|start|serve|watch)|nohup|kill|pkill)(?:\s|$)/u;
const filesystemMutation =
  /(?:^|[;&|]\s*|\s)(?:cp|mv|rm|install|mkdir|rmdir|touch|truncate|tee|dd|rsync|ln|chmod|chown|printf|patch)(?:\s|$)/u;
const inPlaceMutation =
  /(?:^|[;&|]\s*|\s)(?:apply_patch|perl\s+-\S*i\S*|sed\s+-\S*i\S*)(?:\s|$)/u;
const packageManagerMutation =
  /(?:^|[;&|]\s*|\s)(?:(?:npm|pnpm|yarn|bun)\s+(?:add|ci|install|link|remove|uninstall|unlink|update|upgrade)|npx(?:\s|$)|bunx(?:\s|$)|(?:pnpm|yarn)\s+dlx(?:\s|$))/u;
const elevatedOrRemoteScript =
  /\bsudo\b|\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba)?sh\b|>\s*\/dev\/(?!null\b)/u;
const backgroundProcess = /(?:^|\s)&(?:\s|$)/u;
const allowedGitCommands = new Set([
  "cat-file",
  "diff",
  "grep",
  "log",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "show",
  "status",
]);

function writesThroughInterpreter(command: string) {
  return /\b(?:appendfile|copyfile|createwritestream|rename(?:sync)?|rmsync|unlink(?:sync)?|writefile(?:sync)?|write_text)\b|\bshutil\.copy\b|\bopen\([^)]*,\s*["'][^"']*[wax+]/u.test(
    command,
  );
}

function deniedGitCommand(command: string) {
  if (/\bgit\s+-/u.test(command)) return true;
  return [...command.matchAll(/\bgit\s+([a-z][\w-]*)([^;&|\n]*)/gu)].some(
    ([, operation, argumentsValue]) =>
      operation === "branch"
        ? argumentsValue?.trim() !== "--show-current"
        : !allowedGitCommands.has(operation ?? ""),
  );
}

function mutatingRedirection(command: string) {
  return [...command.matchAll(/(?:^|[\s;|&])\d*>{1,2}\s*([^\s;|&]+)/gu)].some(
    ([, target]) => target !== "/dev/null" && !target?.startsWith("&"),
  );
}
