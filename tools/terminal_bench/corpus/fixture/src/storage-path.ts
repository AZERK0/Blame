export function normalizeStorageKey(value: string) {
  return decodeURIComponent(value)
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}
