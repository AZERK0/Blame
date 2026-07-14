export type RepositoryTelemetryCohorts = {
  repositoryLanguage: string;
  repositorySizeBucket: "small" | "medium" | "large" | "very_large";
};

export function repositoryTelemetryCohorts(
  gitFileOutput: string,
): RepositoryTelemetryCohorts {
  const files = gitFileOutput.split("\0").filter(Boolean);
  return {
    repositoryLanguage: dominantRepositoryLanguage(files),
    repositorySizeBucket: repositorySizeBucket(files.length),
  };
}

function dominantRepositoryLanguage(files: string[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = languageFromFile(file);
    if (!language) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  );
  if (ranked.length === 0) return "other";
  if (ranked.length === 1) return ranked[0][0];
  const recognizedFiles = ranked.reduce((total, [, count]) => total + count, 0);
  return ranked[0][1] / recognizedFiles >= 0.6 ? ranked[0][0] : "mixed";
}

function languageFromFile(file: string) {
  const extension = file.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension ? extensionLanguages.get(extension) : undefined;
}

function repositorySizeBucket(fileCount: number) {
  if (fileCount < 100) return "small";
  if (fileCount < 1_000) return "medium";
  if (fileCount < 10_000) return "large";
  return "very_large";
}

const extensionLanguages = new Map([
  ["bash", "shell"],
  ["c", "c"],
  ["cc", "cpp"],
  ["cpp", "cpp"],
  ["cs", "csharp"],
  ["css", "css"],
  ["cxx", "cpp"],
  ["dart", "dart"],
  ["go", "go"],
  ["h", "c"],
  ["hpp", "cpp"],
  ["htm", "html"],
  ["html", "html"],
  ["java", "java"],
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  ["mjs", "javascript"],
  ["php", "php"],
  ["py", "python"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["scss", "css"],
  ["sh", "shell"],
  ["swift", "swift"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["vue", "vue"],
  ["zsh", "shell"],
]);
