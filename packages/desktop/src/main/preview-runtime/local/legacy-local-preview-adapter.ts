import {
  controlProjectPreview,
  projectPreviewRuntimeState,
  readProjectServiceLogs,
} from "../../workspace-ipc";

export const control = controlProjectPreview;
export const state = projectPreviewRuntimeState;
export const logs = readProjectServiceLogs;
