import type { BlameDesktopApi } from "../preload/types"

declare global {
  interface Window {
    blame: BlameDesktopApi
  }
}

export {}
