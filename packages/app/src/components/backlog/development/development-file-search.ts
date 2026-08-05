import Fuse from "fuse.js"

export type DevelopmentFileSearchItem = {
  name: string
  path: string
}

const searchOptions: Fuse.IFuseOptions<DevelopmentFileSearchItem> = {
  ignoreLocation: true,
  keys: [
    { name: "path", weight: 0.8 },
    { name: "name", weight: 1.2 },
  ],
  threshold: 0.38,
}

export function searchDevelopmentFiles(
  items: DevelopmentFileSearchItem[],
  query: string
) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return items

  return new Fuse(items, searchOptions)
    .search(normalizedQuery)
    .map((result) => result.item)
}
