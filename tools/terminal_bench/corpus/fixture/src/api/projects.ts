export type ProjectRecord = {
  id: string;
  title: string;
  createdAt: Date;
};

export function normalizeProjectTitle(title: string) {
  return title.trim();
}

export function serializeProject(project: ProjectRecord) {
  return {
    id: project.id,
    title: normalizeProjectTitle(project.title),
    createdAt: project.createdAt.toISOString(),
  };
}
