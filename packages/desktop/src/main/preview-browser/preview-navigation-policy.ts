export function keepsManagedPreviewBridge(
  currentUrl: string,
  nextUrl: string,
  expectedOrigin: (url: string) => boolean,
) {
  const startsInsidePreview =
    !currentUrl || currentUrl === "about:blank" || expectedOrigin(currentUrl)
  return startsInsidePreview && expectedOrigin(nextUrl)
}
