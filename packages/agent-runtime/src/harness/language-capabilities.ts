export type SemanticParserId =
  | "bash"
  | "c"
  | "cpp"
  | "csharp"
  | "css"
  | "go"
  | "html"
  | "java"
  | "javascript"
  | "python"
  | "rust"
  | "svelte"
  | "typescript"
  | "tsx"
  | "vue";

type ValidatorId = "jsonc" | "prisma" | "semantic_parser" | "typescript";

type LanguageCapability = {
  parserId?: SemanticParserId;
  validatorId?: ValidatorId;
};

const parserByExtension: Record<string, SemanticParserId> = {
  ".bash": "bash",
  ".bats": "bash",
  ".c": "c",
  ".cc": "cpp",
  ".cjs": "javascript",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".cts": "typescript",
  ".cxx": "cpp",
  ".css": "css",
  ".go": "go",
  ".h": "c",
  ".hpp": "cpp",
  ".htm": "html",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".py": "python",
  ".rs": "rust",
  ".sh": "bash",
  ".svelte": "svelte",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".vue": "vue",
};

export function languageCapability(
  path: string,
  content?: Buffer,
): LanguageCapability {
  if (content?.includes(0)) return {};
  const extension = path.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? "";
  const parserId = parserByExtension[extension];
  const validatorId = validatorFor(extension, parserId);
  return {
    ...(parserId ? { parserId } : {}),
    ...(validatorId ? { validatorId } : {}),
  };
}

function validatorFor(
  extension: string,
  parserId?: SemanticParserId,
): ValidatorId | undefined {
  if ([".json", ".jsonc"].includes(extension)) return "jsonc";
  if (extension === ".prisma") return "prisma";
  if (["javascript", "typescript", "tsx"].includes(parserId ?? ""))
    return "typescript";
  return parserId ? "semantic_parser" : undefined;
}
