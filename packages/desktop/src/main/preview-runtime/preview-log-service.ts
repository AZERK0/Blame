import { readProjectServiceLogs } from "../workspace-ipc"

export class PreviewLogService {
  read(input: { service?: string; tailLines?: number; worktree: string }) {
    return readProjectServiceLogs(input)
  }
}

export const previewLogService = new PreviewLogService()
