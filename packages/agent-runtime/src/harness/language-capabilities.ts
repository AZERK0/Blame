import {
  capabilitySnapshot as coreCapabilitySnapshot,
  capabilityToolDescription,
  languageCapability as coreLanguageCapability,
  languageCapabilityRegistry as coreLanguageCapabilityRegistry,
  type CapabilityOperation,
  type LanguageCapability as CoreLanguageCapability,
} from "@blame/harness-core";

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

export type LanguageCapability = CoreLanguageCapability & {
  languageId: string;
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
  "operations"
> & {
  semanticEditing: boolean;
  structuredEditing: boolean;
  symbolInspection: boolean;
  syntaxValidation: boolean;
};

const semanticParserIds = new Set([
  "bash",
  "csharp",
  "css",
  "go",
  "html",
  "java",
  "javascript",
  "python",
  "rust",
  "typescript",
  "vue",
]);

export const languageCapabilityRegistry: readonly LanguageCapability[] =
  coreLanguageCapabilityRegistry.map(legacyCapability);

export const semanticLanguageIds = unique(
  languageCapabilityRegistry
    .filter((capability) => capability.symbolInspection)
    .map((capability) => capability.languageId),
) as [string, ...string[]];

const plainTextCapability: LanguageCapability = legacyCapability({
  language_id: "text",
  extensions: [],
  operations: unavailableOperations("PLAIN_TEXT_ONLY"),
});

const unsupportedCapability: LanguageCapability = {
  ...plainTextCapability,
  language_id: "binary",
  languageId: "binary",
  level: "unsupported",
};

export function languageCapability(path: string, content?: Buffer) {
  if (content?.includes(0)) return unsupportedCapability;
  const capability = coreLanguageCapability(path);
  return capability ? legacyCapability(capability) : plainTextCapability;
}

export function publicLanguageCapabilities(
  capability: LanguageCapability,
): PublicLanguageCapabilities {
  return {
    symbolInspection: capability.symbolInspection,
    semanticEditing: capability.semanticEditing,
    structuredEditing: capability.structuredEditing,
    syntaxValidation: capability.syntaxValidation,
    operations: cloneOperations(capability.operations),
  };
}

export function recommendedEditTool(capability: LanguageCapability) {
  const nativeSemantic = capability.operations.replace_symbol;
  if (nativeSemantic.support === "native") return "edit_symbol";
  if (capability.structuredEditing) return "edit_json";
  if (capability.level === "unsupported") return null;
  if (nativeSemantic.support === "fallback") return nativeSemantic.tool;
  return capability.level === "validated_text" ? "patch_file" : "replace_file";
}

export function supportedOperationsDescription(paths?: string[]) {
  return [
    "Supported operations are generated from the canonical per-language capability registry:",
    capabilityToolDescription(paths),
  ].join("\n");
}

export function semanticInspectionExtensionsDescription() {
  return unique(
    languageCapabilityRegistry
      .filter((capability) => capability.symbolInspection)
      .flatMap((capability) => capability.extensions),
  ).join(", ");
}

export function capabilityRegistrySnapshot(paths?: string[]) {
  const capabilities = paths
    ? coreCapabilitySnapshot(paths)
    : coreLanguageCapabilityRegistry;
  return capabilities.map((capability) => ({
    ...legacyCapability(capability),
    recommendedEditTool: recommendedEditTool(legacyCapability(capability)),
  }));
}

export function supportedCapabilityOperations(paths?: string[]) {
  return unique(
    capabilityRegistrySnapshot(paths).flatMap((capability) =>
      Object.entries(capability.operations)
        .filter(([, support]) => support.support !== "unavailable")
        .map(([operation]) => operation),
    ),
  ) as CapabilityOperation[];
}

function legacyCapability(
  capability: CoreLanguageCapability,
): LanguageCapability {
  const parserId = semanticParserId(capability);
  const level = capabilityLevel(capability);
  return {
    ...capability,
    extensions: [...capability.extensions],
    operations: cloneOperations(capability.operations),
    languageId: capability.language_id,
    level,
    symbolInspection:
      capability.operations.inspect_symbol.support !== "unavailable",
    semanticEditing:
      capability.operations.replace_symbol.support !== "unavailable",
    syntaxValidation:
      capability.operations.parse_validation.support !== "unavailable",
    structuredEditing:
      capability.operations.structured_edit.support === "native",
    ...(parserId ? { parserId } : {}),
    ...(validatorId(capability, level)
      ? { validatorId: validatorId(capability, level) }
      : {}),
  };
}

function capabilityLevel(
  capability: CoreLanguageCapability,
): CapabilitySupportLevel {
  if (capability.operations.outline.support !== "unavailable")
    return "semantic";
  if (capability.operations.structured_edit.support === "native")
    return "structured";
  if (capability.operations.parse_validation.support !== "unavailable")
    return "validated_text";
  return "plain_text";
}

function semanticParserId(
  capability: CoreLanguageCapability,
): SemanticParserId | undefined {
  if (capability.operations.outline.support === "unavailable") return undefined;
  if (
    capability.language_id === "typescript" &&
    capability.extensions.includes(".tsx")
  )
    return "tsx";
  if (
    capability.language_id === "javascript" &&
    capability.extensions.includes(".jsx")
  )
    return "tsx";
  return semanticParserIds.has(capability.language_id)
    ? (capability.language_id as SemanticParserId)
    : undefined;
}

function validatorId(
  capability: CoreLanguageCapability,
  level: CapabilitySupportLevel,
) {
  if (level === "structured") return "jsonc" as const;
  if (capability.language_id === "prisma") return "prisma" as const;
  if (["javascript", "typescript"].includes(capability.language_id))
    return "typescript" as const;
  if (capability.operations.parse_validation.support !== "unavailable")
    return "semantic_parser" as const;
  return undefined;
}

function cloneOperations(operations: CoreLanguageCapability["operations"]) {
  return Object.fromEntries(
    Object.entries(operations).map(([operation, support]) => [
      operation,
      support.support === "unavailable"
        ? { ...support }
        : {
            ...support,
            guarantees: [...support.guarantees],
            limitations: [...support.limitations],
          },
    ]),
  ) as CoreLanguageCapability["operations"];
}

function unavailableOperations(
  reasonCode: string,
): CoreLanguageCapability["operations"] {
  const operations: CapabilityOperation[] = [
    "outline",
    "inspect_symbol",
    "inspect_body",
    "inspect_relations",
    "replace_symbol",
    "replace_body",
    "replace_signature",
    "insert_sibling",
    "delete_symbol",
    "structured_edit",
    "parse_validation",
    "semantic_rebase_read",
    "semantic_rebase_write",
  ];
  return Object.fromEntries(
    operations.map((operation) => [
      operation,
      { support: "unavailable", reason_code: reasonCode },
    ]),
  ) as CoreLanguageCapability["operations"];
}

function unique<T>(values: T[]) {
  return [...new Set(values)].sort();
}
