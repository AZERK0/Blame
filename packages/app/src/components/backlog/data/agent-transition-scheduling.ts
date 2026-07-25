export function afterRendererPaint() {
  return new Promise<void>((resolve) => {
    window.requestIdleCallback(() => resolve(), { timeout: 100 })
  })
}
