import { readProjectServiceLogs } from "../workspace-ipc";

export class PreviewLogService {
  read(input: { service?: string; tailLines?: number; worktree: string }) {
    return readProjectServiceLogs({ ...input, timeoutMs: 3_000 });
  }
}

export const previewLogService = new PreviewLogService();
