export function liveSourceImportAllowed(source: {
  mode?: string;
  baseHash?: string;
  workspaceHash?: string;
}) {
  return Boolean(
    source.mode === "delta" &&
      source.baseHash &&
      source.workspaceHash &&
      /^[a-f0-9]{64}$/i.test(source.baseHash) &&
      /^[a-f0-9]{64}$/i.test(source.workspaceHash) &&
      source.baseHash !== source.workspaceHash,
  );
}
