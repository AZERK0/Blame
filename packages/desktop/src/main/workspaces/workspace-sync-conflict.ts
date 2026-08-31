export class WorkspaceSyncConflict extends Error {
  readonly code = "WORKSPACE_SYNC_CONFLICT";
  readonly paths: string[];

  constructor(message: string, paths: string[] = []) {
    super(message);
    this.name = "WorkspaceSyncConflict";
    this.paths = paths;
  }
}
