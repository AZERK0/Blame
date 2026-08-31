import { parseCode } from "./code-intelligence.js";

export type LightCapabilityLevel = "symbol" | "structural" | "raw";

export type LoadedLanguageCapability = {
  extensions: string[];
  language: string;
  level: LightCapabilityLevel;
  loaded: boolean;
  parse: "available" | "unavailable" | "unsupported";
};

type AdapterDefinition = Omit<LoadedLanguageCapability, "loaded" | "parse"> & {
  sample: string;
  samplePath: string;
};

const adapters: AdapterDefinition[] = [
  adapter(
    "typescript",
    [".ts", ".mts", ".cts"],
    "symbol",
    "sample.ts",
    "export function sample() { return 1 }",
  ),
  adapter(
    "tsx",
    [".tsx"],
    "symbol",
    "sample.tsx",
    "export function Sample() { return <div /> }",
  ),
  adapter(
    "javascript",
    [".js", ".mjs", ".cjs"],
    "symbol",
    "sample.js",
    "export function sample() { return 1 }",
  ),
  adapter(
    "jsx",
    [".jsx"],
    "symbol",
    "sample.jsx",
    "export function Sample() { return <div /> }",
  ),
  adapter(
    "python",
    [".py"],
    "symbol",
    "sample.py",
    "def sample():\n    return 1\n",
  ),
  adapter("rust", [".rs"], "symbol", "sample.rs", "fn sample() -> i32 { 1 }"),
  adapter(
    "go",
    [".go"],
    "symbol",
    "sample.go",
    "package sample\nfunc Sample() int { return 1 }",
  ),
  adapter(
    "java",
    [".java"],
    "symbol",
    "Sample.java",
    "class Sample { int value() { return 1; } }",
  ),
  adapter(
    "csharp",
    [".cs"],
    "symbol",
    "Sample.cs",
    "class Sample { int Value() { return 1; } }",
  ),
  adapter(
    "c",
    [".c", ".h"],
    "symbol",
    "sample.c",
    "int sample(void) { return 1; }",
  ),
  adapter(
    "cpp",
    [".cpp", ".cc", ".cxx", ".hpp"],
    "symbol",
    "sample.cpp",
    "class Sample { public: int value() { return 1; } };",
  ),
  adapter(
    "html",
    [".html", ".htm"],
    "structural",
    "sample.html",
    '<main id="sample"><p>value</p></main>',
  ),
  adapter(
    "css",
    [".css"],
    "structural",
    "sample.css",
    ".sample { color: red; }",
  ),
  adapter(
    "vue",
    [".vue"],
    "structural",
    "sample.vue",
    "<template><main /></template><script>export function sample() { return 1 }</script>",
  ),
  adapter(
    "svelte",
    [".svelte"],
    "structural",
    "sample.svelte",
    "<main>value</main><script>function sample() { return 1 }</script>",
  ),
];

const rawExtensions = [
  ".prisma",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".sql",
  ".md",
  ".env",
];

let cachedRegistry: LoadedLanguageCapability[] | undefined;

export function runtimeCapabilityRegistry() {
  if (!cachedRegistry) cachedRegistry = adapters.map(loadAdapter);
  return cachedRegistry.map((capability) => ({
    ...capability,
    extensions: [...capability.extensions],
  }));
}

export function capabilityForPath(path: string) {
  const extension = fileExtension(path);
  return runtimeCapabilityRegistry().find((item) =>
    item.extensions.includes(extension),
  );
}

export function lightCapabilityDescription() {
  const registry = runtimeCapabilityRegistry();
  const symbolic = loadedExtensions(registry, "symbol");
  const structural = loadedExtensions(registry, "structural");
  return [
    `Symbol read/edit: ${symbolic.join(" ") || "unavailable"}`,
    `Structural read/edit: ${structural.join(" ") || "unavailable"}`,
    `Raw/range/patch: ${rawExtensions.join(" ")} and all unsupported formats`,
  ].join("\n");
}

export function parseAvailability(path: string) {
  return capabilityParseAvailability(capabilityForPath(path));
}

export function capabilityParseAvailability(
  capability?: Pick<LoadedLanguageCapability, "loaded">,
) {
  if (!capability) return "unsupported" as const;
  return capability.loaded ? ("available" as const) : ("unavailable" as const);
}

function adapter(
  language: string,
  extensions: string[],
  level: Exclude<LightCapabilityLevel, "raw">,
  samplePath: string,
  sample: string,
): AdapterDefinition {
  return { extensions, language, level, sample, samplePath };
}

function loadAdapter(input: AdapterDefinition): LoadedLanguageCapability {
  const parsed = parseCode(input.samplePath, Buffer.from(input.sample));
  const loaded =
    parsed.supported && parsed.errorCount === 0 && parsed.symbols.length > 0;
  return {
    extensions: [...input.extensions],
    language: input.language,
    level: input.level,
    loaded,
    parse: loaded ? "available" : "unavailable",
  };
}

function loadedExtensions(
  registry: LoadedLanguageCapability[],
  level: LightCapabilityLevel,
) {
  return registry
    .filter((capability) => capability.level === level && capability.loaded)
    .flatMap((capability) => capability.extensions);
}

function fileExtension(path: string) {
  return path.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? "";
}
