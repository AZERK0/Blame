export type IndexedProject = {
  id: string;
  title: string;
};

export function projectTitleAt(projects: IndexedProject[], index: number) {
  return projects[index].title;
}
