import { slugifyProject } from "./slug";

export type ProjectLink = {
  id: string;
  title: string;
};

export function projectUrl(project: ProjectLink) {
  return `/projects/${slugifyProject(project.title)}`;
}
