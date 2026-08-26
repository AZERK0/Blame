export type CapabilitySupportLevel =
  | "semantic"
  | "structured"
  | "validated_text"
  | "plain_text"
  | "unsupported";

export type SemanticParserId =
  | "bash"
  | "csharp"
  | "css"
  | "go"
  | "html"
  | "java"
  | "javascript"
  | "python"
  | "rust"
  | "typescript"
  | "tsx"
  | "vue";

export type LanguageCapability = {
  languageId: string;
  extensions: string[];
  level: CapabilitySupportLevel;
  symbolInspection: boolean;
  semanticEditing: boolean;
  syntaxValidation: boolean;
  structuredEditing: boolean;
  parserId?: SemanticParserId;
  validatorId?: "jsonc" | "prisma" | "semantic_parser" | "typescript";
};

export type PublicLanguageCapabilities = Pick<
  LanguageCapability,
  | "semanticEditing"
  | "structuredEditing"
  | "symbolInspection"
  | "syntaxValidation"
>;

export const languageCapabilityRegistry: readonly LanguageCapability[] = [
  semanticCapability("bash", [".bash", ".bats", ".sh"], "bash"),
  semanticCapability("csharp", [".cs"], "csharp"),
  semanticCapability("css", [".css"], "css"),
  semanticCapability("go", [".go"], "go"),
  semanticCapability("java", [".java"], "java"),
  semanticCapability(
    "javascript",
    [".cjs", ".js", ".mjs"],
    "javascript",
    "typescript",
  ),
  semanticCapability("javascript", [".jsx"], "tsx", "typescript"),
  semanticCapability("python", [".py"], "python"),
  semanticCapability("rust", [".rs"], "rust"),
  semanticCapability(
    "typescript",
    [".cts", ".mts", ".ts"],
    "typescript",
    "typescript",
  ),
  semanticCapability("typescript", [".tsx"], "tsx", "typescript"),
  semanticCapability("vue", [".vue"], "vue"),
  structuredCapability("json", [".json", ".jsonc"]),
  validatedTextCapability("html", [".htm", ".html"], "html"),
  validatedTextCapability("prisma", [".prisma"], undefined, "prisma"),
] as const;

export const semanticLanguageIds = unique(
  languageCapabilityRegistry
    .filter((capability) => capability.parserId)
    .map((capability) => capability.languageId),
) as [string, ...string[]];

const plainTextCapability: LanguageCapability = {
  languageId: "text",
  extensions: [],
  level: "plain_text",
  symbolInspection: false,
  semanticEditing: false,
  syntaxValidation: false,
  structuredEditing: false,
};

const unsupportedCapability: LanguageCapability = {
  ...plainTextCapability,
  languageId: "binary",
  level: "unsupported",
};

export function languageCapability(path: string, content?: Buffer) {
  if (content?.includes(0)) return unsupportedCapability;
  const suffix = fileExtension(path);
  return (
    languageCapabilityRegistry.find(({ extensions }) =>
      extensions.includes(suffix),
    ) ?? plainTextCapability
  );
}

export function publicLanguageCapabilities(
  capability: LanguageCapability,
): PublicLanguageCapabilities {
  return {
    symbolInspection: capability.symbolInspection,
    semanticEditing: capability.semanticEditing,
    structuredEditing: capability.structuredEditing,
    syntaxValidation: capability.syntaxValidation,
  };
}

export function recommendedEditTool(capability: LanguageCapability) {
  if (capability.semanticEditing) return "edit_symbol";
  if (capability.structuredEditing) return "edit_json";
  if (capability.level === "unsupported") return null;
  return capability.level === "validated_text" ? "patch_file" : "replace_file";
}

export function supportedOperationsDescription() {
  const groups = capabilityExtensionGroups();
  return [
    "Supported operations:",
    `- Semantic: ${groups.semantic || "none"}`,
    `- Structured: ${groups.structured || "none"}`,
    `- Validated text: ${groups.validatedText || "none"}`,
    "- Plain text: all other text files",
    "Use edit_json for JSON-like files. Use patch_file or replace_file when semantic editing is unavailable. The runtime validates support before writing.",
  ].join("\n");
}

export function capabilityRegistrySnapshot() {
  return languageCapabilityRegistry.map((capability) => ({
    ...capability,
    extensions: [...capability.extensions],
    recommendedEditTool: recommendedEditTool(capability),
  }));
}

function semanticCapability(
  languageId: string,
  extensions: string[],
  parserId: SemanticParserId,
  validatorId: "semantic_parser" | "typescript" = "semantic_parser",
): LanguageCapability {
  return {
    languageId,
    extensions,
    level: "semantic",
    symbolInspection: true,
    semanticEditing: true,
    syntaxValidation: true,
    structuredEditing: false,
    parserId,
    validatorId,
  };
}

function structuredCapability(
  languageId: string,
  extensions: string[],
): LanguageCapability {
  return {
    languageId,
    extensions,
    level: "structured",
    symbolInspection: false,
    semanticEditing: false,
    syntaxValidation: true,
    structuredEditing: true,
    validatorId: "jsonc",
  };
}

function validatedTextCapability(
  languageId: string,
  extensions: string[],
  parserId?: SemanticParserId,
  validatorId: "prisma" | "semantic_parser" = "semantic_parser",
): LanguageCapability {
  return {
    languageId,
    extensions,
    level: "validated_text",
    symbolInspection: false,
    semanticEditing: false,
    syntaxValidation: true,
    structuredEditing: false,
    ...(parserId ? { parserId } : {}),
    validatorId,
  };
}

function capabilityExtensionGroups() {
  return {
    semantic: extensionsForLevel("semantic"),
    structured: extensionsForLevel("structured"),
    validatedText: extensionsForLevel("validated_text"),
  };
}

function extensionsForLevel(level: CapabilitySupportLevel) {
  return unique(
    languageCapabilityRegistry
      .filter((capability) => capability.level === level)
      .flatMap((capability) => capability.extensions),
  ).join(", ");
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function fileExtension(path: string) {
  return path.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? "";
}
