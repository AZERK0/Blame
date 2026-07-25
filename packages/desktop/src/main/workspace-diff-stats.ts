export type WorkspaceDiffStats = {
  additions: number;
  deletions: number;
  files: number;
};

export function workspaceDiffStats(numstat: string): WorkspaceDiffStats {
  return numstat
    .split("\n")
    .filter(Boolean)
    .reduce(
      (stats, line) => {
        const [additions, deletions] = line.split("\t");
        return {
          additions: stats.additions + numericChangeCount(additions),
          deletions: stats.deletions + numericChangeCount(deletions),
          files: stats.files + 1,
        };
      },
      { additions: 0, deletions: 0, files: 0 },
    );
}

function numericChangeCount(value: string | undefined) {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}
