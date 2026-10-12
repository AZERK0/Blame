import { parseCode } from "./code-intelligence.js";
import type { TaskCatalogItem } from "./task-catalog.js";

/** Identify a literal npm test selection; never interpret shell expansion or compound commands. */
export function projectTestCommand(command: string, cwd: string, tasks: TaskCatalogItem[], platform = process.platform) {
  // The raw command uses cmd.exe on Windows; Bash quote semantics do not apply.
  if (platform === "win32") return undefined;
  const root = parseCode("command.sh", Buffer.from(command)).trees[0]?.root;
  const nodes = root?.children();
  if (nodes?.length !== 1 || nodes[0]!.kind() !== "command" || nodes[0]!.text() !== command.trim())
    return undefined;
  const tokens = nodes[0]!.children().map(node => {
    const text = node.text(), kind = node.kind();
    if ((kind === "word" || kind === "command_name") && /^[A-Za-z0-9_./:@%=,+-]+$/u.test(text))
      return text;
    if (kind === "raw_string" && text.startsWith("'") && text.endsWith("'"))
      return text.slice(1, -1);
    if (kind === "string" && text.startsWith('"') && text.endsWith('"') && !/[$`\\\r\n]/u.test(text))
      return text.slice(1, -1);
    return undefined;
  });
  if (tokens.some(token => token === undefined) || tokens[0] !== "npm") return undefined;
  const words = tokens as string[];
  const script = words[1] === "run" ? words[2] : words[1] === "test" ? "test" : undefined;
  const offset = words[1] === "run" ? 3 : 2;
  // npm options before -- are not arguments passed literally to the test script.
  if (!script || words[offset] !== "--") return undefined;
  const args = words.slice(offset + 1);
  if (args.length > 32 || args.some(arg => !arg.length || arg.length > 2_048 || arg.includes("\0")))
    return undefined;
  const candidates = tasks.filter(task => task.cwd === cwd && task.kind === "test" &&
    task.package_manager === "npm" && task.script === script);
  if (candidates.length !== 1) return undefined;
  return { taskId: candidates[0]!.task_id, taskKind: "test", ...(args.length ? { args } : {}) };
}
