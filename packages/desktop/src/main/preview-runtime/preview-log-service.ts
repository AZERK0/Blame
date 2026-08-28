import { readProjectServiceLogs } from "../workspace-ipc.ts";
import { PreviewLogService } from "./preview-log-reader.ts";

export { PreviewLogService } from "./preview-log-reader.ts";

export const previewLogService = new PreviewLogService(readProjectServiceLogs);
