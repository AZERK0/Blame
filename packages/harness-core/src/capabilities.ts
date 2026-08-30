export type CapabilityOperation =
  | "outline"
  | "inspect_symbol"
  | "inspect_body"
  | "inspect_relations"
  | "replace_symbol"
  | "replace_body"
  | "replace_signature"
  | "insert_sibling"
  | "delete_symbol"
  | "structured_edit"
  | "parse_validation"
  | "semantic_rebase_read"
  | "semantic_rebase_write";

export type OperationSupport =
  | {
      support: "native";
      engine: string;
      engine_version: string;
      guarantees: string[];
      limitations: string[];
    }
  | {
      support: "fallback";
      tool: string;
      guarantees: string[];
      limitations: string[];
    }
  | {
      support: "unavailable";
      reason_code: string;
    };

export type LanguageCapability = {
  language_id: string;
  extensions: string[];
  operations: Record<CapabilityOperation, OperationSupport>;
};

const semanticOperations: CapabilityOperation[] = [
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

export const languageCapabilityRegistry: readonly LanguageCapability[] = [
  typescriptLanguage("typescript", [".cts", ".mts", ".ts"]),
  typescriptLanguage("typescript", [".tsx"]),
  typescriptLanguage("javascript", [".cjs", ".js", ".mjs"]),
  typescriptLanguage("javascript", [".jsx"]),
  cssLanguage(),
  parserLanguage("bash", [".bash", ".bats", ".sh"], "ast-grep-bash", "0.0.8"),
  parserLanguage("csharp", [".cs"], "ast-grep-csharp", "0.0.6"),
  parserLanguage("go", [".go"], "ast-grep-go", "0.0.6"),
  parserLanguage("java", [".java"], "ast-grep-java", "0.0.7"),
  parserLanguage("python", [".py"], "ast-grep-python", "0.0.6"),
  parserLanguage("rust", [".rs"], "ast-grep-rust", "0.0.7"),
  parserLanguage("vue", [".vue"], "ast-grep", "0.42"),
  structuredLanguage("json", [".json", ".jsonc"], "jsonc-parser", "3.3"),
  validatedLanguage("html", [".htm", ".html"], "ast-grep", "0.42"),
  validatedLanguage("prisma", [".prisma"], "prisma-validate", "declared"),
] as const;

export function languageCapability(path: string) {
  const extension = fileExtension(path);
  return languageCapabilityRegistry.find((capability) =>
    capability.extensions.includes(extension),
  );
}

export function capabilitySnapshot(paths: string[]) {
  const present = new Set(paths.map(fileExtension));
  return languageCapabilityRegistry
    .filter((capability) =>
      capability.extensions.some((extension) => present.has(extension)),
    )
    .map(cloneCapability);
}

export function capabilityToolDescription(paths?: string[]) {
  const registry = paths
    ? capabilitySnapshot(paths)
    : languageCapabilityRegistry.map(cloneCapability);
  return registry.map(describeLanguage).join("\n");
}

export function capabilityJsonSchema() {
  return {
    type: "array",
    items: {
      type: "object",
      required: ["language_id", "extensions", "operations"],
      properties: {
        language_id: { type: "string" },
        extensions: { type: "array", items: { type: "string" } },
        operations: {
          type: "object",
          required: [...semanticOperations],
          properties: Object.fromEntries(
            semanticOperations.map((operation) => [
              operation,
              operationSupportSchema(),
            ]),
          ),
        },
      },
    },
  };
}

function typescriptLanguage(
  languageId: string,
  extensions: string[],
): LanguageCapability {
  const operations = nativeSemanticOperations("ast-grep-napi", "0.42");
  operations.inspect_relations = native(
    "typescript-compiler",
    "5.9",
    ["revision_bound", "bounded_scope"],
    ["typescript_project_resolution"],
  );
  operations.parse_validation = native(
    "typescript-compiler",
    "5.9",
    ["post_parse_required"],
    ["syntax_diagnostics_only"],
  );
  operations.structured_edit = fallback(
    "edit_files",
    ["cas_guarded", "post_parse_required"],
    ["textual_fallback"],
  );
  return { language_id: languageId, extensions, operations };
}

function parserLanguage(
  languageId: string,
  extensions: string[],
  engine: string,
  engineVersion: string,
): LanguageCapability {
  const operations = unavailableOperations("OPERATION_NOT_IMPLEMENTED");
  operations.outline = native(
    engine,
    engineVersion,
    ["complete_syntax_boundary"],
    ["syntax_only"],
  );
  operations.inspect_symbol = native(
    engine,
    engineVersion,
    ["complete_syntax_boundary"],
    ["syntax_only"],
  );
  operations.inspect_body = native(
    engine,
    engineVersion,
    ["complete_syntax_boundary"],
    ["syntax_only"],
  );
  operations.inspect_relations = fallback(
    "get_relation_context",
    ["bounded_scope"],
    ["lexical_relations"],
  );
  operations.parse_validation = native(
    engine,
    engineVersion,
    ["post_parse_required"],
    ["syntax_only"],
  );
  operations.semantic_rebase_read = native(
    engine,
    engineVersion,
    ["unique_candidate_required"],
    ["bounded_search"],
  );
  for (const operation of writeOperations())
    operations[operation] = textualEditFallback();
  return { language_id: languageId, extensions, operations };
}

function cssLanguage(): LanguageCapability {
  const capability = parserLanguage("css", [".css"], "ast-grep-napi", "0.42");
  const nativeOperations = [
    "replace_symbol",
    "replace_body",
    "insert_sibling",
    "delete_symbol",
  ] as const;
  for (const operation of nativeOperations)
    capability.operations[operation] = native(
      "ast-grep-napi+edit-service",
      "0.42",
      ["preserves_comments", "cas_guarded", "post_parse_required"],
      ["css_rule_targets"],
    );
  capability.operations.structured_edit = native(
    "css-declaration-editor",
    "1",
    ["preserves_comments", "cas_guarded"],
    ["declarations_only"],
  );
  capability.operations.semantic_rebase_write = native(
    "semantic-rebase/v1",
    "1",
    ["unique_candidate_required", "cas_guarded"],
    ["bounded_search"],
  );
  return capability;
}

function structuredLanguage(
  languageId: string,
  extensions: string[],
  engine: string,
  engineVersion: string,
): LanguageCapability {
  const operations = unavailableOperations("SEMANTIC_STRUCTURE_UNAVAILABLE");
  operations.structured_edit = native(
    engine,
    engineVersion,
    ["preserves_comments", "cas_guarded", "post_parse_required"],
    ["json_values_only"],
  );
  operations.parse_validation = native(
    engine,
    engineVersion,
    ["post_parse_required"],
    ["json_syntax_only"],
  );
  return { language_id: languageId, extensions, operations };
}

function validatedLanguage(
  languageId: string,
  extensions: string[],
  engine: string,
  engineVersion: string,
): LanguageCapability {
  const operations = unavailableOperations("SEMANTIC_STRUCTURE_UNAVAILABLE");
  operations.parse_validation = native(
    engine,
    engineVersion,
    ["post_parse_required"],
    ["syntax_only"],
  );
  operations.structured_edit = textualEditFallback();
  return { language_id: languageId, extensions, operations };
}

function nativeSemanticOperations(engine: string, engineVersion: string) {
  const operations = unavailableOperations("OPERATION_NOT_IMPLEMENTED");
  const readGuarantees = ["complete_syntax_boundary", "revision_bound"];
  const writeGuarantees = [
    "preserves_comments",
    "cas_guarded",
    "post_parse_required",
  ];
  for (const operation of [
    "outline",
    "inspect_symbol",
    "inspect_body",
    "inspect_relations",
  ] as const)
    operations[operation] = native(engine, engineVersion, readGuarantees, [
      "bounded_relations",
    ]);
  for (const operation of writeOperations())
    operations[operation] = native(engine, engineVersion, writeGuarantees, [
      "single_symbol_target",
    ]);
  operations.parse_validation = native(
    engine,
    engineVersion,
    ["post_parse_required"],
    ["project_configuration_dependent"],
  );
  operations.semantic_rebase_read = native(
    "semantic-rebase/v1",
    "1",
    ["unique_candidate_required"],
    ["bounded_search"],
  );
  operations.semantic_rebase_write = native(
    "semantic-rebase/v1",
    "1",
    ["unique_candidate_required", "cas_guarded"],
    ["bounded_search"],
  );
  return operations;
}

function unavailableOperations(
  reasonCode: string,
): Record<CapabilityOperation, OperationSupport> {
  return Object.fromEntries(
    semanticOperations.map((operation) => [operation, unavailable(reasonCode)]),
  ) as Record<CapabilityOperation, OperationSupport>;
}

function writeOperations() {
  return [
    "replace_symbol",
    "replace_body",
    "replace_signature",
    "insert_sibling",
    "delete_symbol",
  ] as const;
}

function textualEditFallback() {
  return fallback(
    "edit_files",
    ["cas_guarded", "post_parse_required"],
    ["semantic_identity_not_preserved"],
  );
}

function native(
  engine: string,
  engineVersion: string,
  guarantees: string[],
  limitations: string[],
): OperationSupport {
  return {
    support: "native",
    engine,
    engine_version: engineVersion,
    guarantees: [...guarantees],
    limitations: [...limitations],
  };
}

function fallback(
  tool: string,
  guarantees: string[],
  limitations: string[],
): OperationSupport {
  return {
    support: "fallback",
    tool,
    guarantees: [...guarantees],
    limitations: [...limitations],
  };
}

function unavailable(reasonCode: string): OperationSupport {
  return { support: "unavailable", reason_code: reasonCode };
}

function cloneCapability(capability: LanguageCapability): LanguageCapability {
  return {
    language_id: capability.language_id,
    extensions: [...capability.extensions],
    operations: Object.fromEntries(
      Object.entries(capability.operations).map(([operation, support]) => [
        operation,
        cloneSupport(support),
      ]),
    ) as Record<CapabilityOperation, OperationSupport>,
  };
}

function cloneSupport(support: OperationSupport): OperationSupport {
  if (support.support === "unavailable") return { ...support };
  return {
    ...support,
    guarantees: [...support.guarantees],
    limitations: [...support.limitations],
  };
}

function describeLanguage(capability: LanguageCapability) {
  const supported = semanticOperations
    .filter(
      (operation) => capability.operations[operation].support !== "unavailable",
    )
    .map(
      (operation) => `${operation}:${capability.operations[operation].support}`,
    )
    .join(", ");
  return `${capability.language_id} (${capability.extensions.join(", ")}): ${supported}`;
}

function operationSupportSchema() {
  return {
    oneOf: [
      {
        type: "object",
        required: [
          "support",
          "engine",
          "engine_version",
          "guarantees",
          "limitations",
        ],
      },
      {
        type: "object",
        required: ["support", "tool", "guarantees", "limitations"],
      },
      { type: "object", required: ["support", "reason_code"] },
    ],
  };
}

function fileExtension(path: string) {
  return path.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? "";
}
