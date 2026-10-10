export type ProjectSnapshot = { revision: number; title: string; owner: string };
export type RevisionUpdate = { revision: number; title: string };
export function applyRevision(state: ProjectSnapshot, update: RevisionUpdate): ProjectSnapshot {
  return { ...state, ...update };
}
