export type ProjectAction = "delete" | "edit" | "publish" | "view";
export type ProjectRole = "editor" | "owner" | "viewer";
export type ProjectState = "archived" | "draft" | "published";

export function canPerformProjectAction(
  role: ProjectRole,
  action: ProjectAction,
  _state: ProjectState,
) {
  if (role === "owner") return true;
  if (role === "viewer") return action === "view";
  return action !== "delete";
}
