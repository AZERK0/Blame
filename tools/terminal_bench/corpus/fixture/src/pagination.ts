export type PaginatedProject = {
  createdAt: string;
  id: string;
  published: boolean;
};

export function paginatePublishedProjects(
  projects: PaginatedProject[],
  page: number,
  pageSize: number,
) {
  const start = (page - 1) * pageSize;
  return projects
    .filter((project) => project.published)
    .slice(start, start + pageSize);
}
