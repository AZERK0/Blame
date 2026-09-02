export type CachedProject = {
  id: string;
  title: string;
};

const projectCache = new Map<string, CachedProject>();

export async function getCachedProject(
  id: string,
  load: () => Promise<CachedProject>,
) {
  const cached = projectCache.get(id);
  if (cached) return cached;
  const project = await load();
  projectCache.set(id, project);
  return project;
}

export function clearProjectCache() {
  projectCache.clear();
}
