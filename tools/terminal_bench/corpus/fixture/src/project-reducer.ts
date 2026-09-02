export type ProjectSaveState = {
  activeRequestId?: string;
  error?: string;
  savedTitle: string;
  status: "error" | "idle" | "saving";
  title: string;
};

export type ProjectSaveAction =
  | { requestId: string; type: "save_started" }
  | { requestId: string; type: "save_succeeded" }
  | { message: string; requestId: string; type: "save_failed" };

export function projectSaveReducer(
  state: ProjectSaveState,
  action: ProjectSaveAction,
): ProjectSaveState {
  if (action.type === "save_started")
    return { ...state, activeRequestId: action.requestId, status: "saving" };
  if (action.type === "save_succeeded")
    return { ...state, savedTitle: state.title, status: "idle" };
  return { ...state, error: action.message, status: "error" };
}
