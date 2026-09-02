export function slugifyProject(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, "-");
}
