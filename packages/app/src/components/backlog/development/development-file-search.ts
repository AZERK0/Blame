import Fuse from "fuse.js"

export type DevelopmentFileSearchItem = {
  name: string
  path: string
}

export function normalizeDevelopmentFileSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
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
  const normalizedQuery = normalizeDevelopmentFileSearchText(query)
  if (!normalizedQuery) return items

  const normalizedItems = items.map((item) => ({
    name: normalizeDevelopmentFileSearchText(item.name),
    path: normalizeDevelopmentFileSearchText(item.path),
  }))

  return new Fuse(normalizedItems, searchOptions)
    .search(normalizedQuery)
    .map((result) => items[result.refIndex])
    .filter((item): item is DevelopmentFileSearchItem => Boolean(item))
}
