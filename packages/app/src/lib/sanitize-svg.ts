import DOMPurify from "dompurify"

export function sanitizeSvg(value: string) {
  if (!DOMPurify.isSupported) return value
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { svg: true, svgFilters: true },
  })
}
