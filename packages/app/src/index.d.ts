import type { Root } from "react-dom/client"
import type { ComponentType } from "react"
import type { Platform } from "./context/platform"

export declare const App: ComponentType
export type {
  BacklogStatusPipRequest,
  BacklogStatusPipSnapshot,
  Platform,
} from "./context/platform"

export type MountAppOptions = {
  platform?: Platform
}

export declare function mountApp(
  element: HTMLElement,
  options?: MountAppOptions
): Root
