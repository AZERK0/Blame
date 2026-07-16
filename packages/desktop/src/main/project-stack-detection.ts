import type { PreviewManifest } from "@blame/preview-contract";

const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export function detectedStackUsesNext(manifest: PreviewManifest | undefined) {
  const detectedStack = manifest?.project.detectedStack;
  if (!detectedStack?.length) return undefined;
  return detectedStack.some((stack) => {
    const normalized = stack.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalized === "next" || normalized === "nextjs";
  });
}

export function packageJsonUsesNext(content: string | null) {
  if (!content) return false;
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    return dependencySections.some((section) =>
      hasNextDependency(value[section]),
    );
  } catch {
    return false;
  }
}

function hasNextDependency(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.hasOwn(value, "next");
}
