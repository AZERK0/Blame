export const ignoredGitDiffPathspecs = [":(exclude).blame/**"] as const;

export function isIgnoredWorkspaceDiffPath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  return normalized === ".blame" || normalized.startsWith(".blame/");
}
