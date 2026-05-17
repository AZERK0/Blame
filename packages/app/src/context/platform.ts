import * as React from "react"

type PickerPaths = string | string[] | null

export type OpenDirectoryPickerOptions = {
  title?: string
  multiple?: boolean
}

export type Platform = {
  api?: ApiConnection
  openDirectoryPickerDialog?(
    options?: OpenDirectoryPickerOptions
  ): Promise<PickerPaths>
  openExternalLink?(url: string): void
  getServer?(): Promise<ServerConnection | undefined>
}

export type ServerConnection = {
  url: string
  username?: string | null
  password?: string | null
}

export type ApiConnection = {
  url: string
  token?: string | null
}

export const PlatformContext = React.createContext<Platform>({})

export function usePlatform() {
  return React.useContext(PlatformContext)
}

export function createWebPlatform(): Platform {
  return {
    async openDirectoryPickerDialog(options) {
      const value = window.prompt(options?.title ?? "Open Project")
      return value?.trim() || null
    },
    async getServer() {
      return { url: "http://localhost:4096" }
    },
    openExternalLink(url) {
      window.open(url, "_blank", "noopener,noreferrer")
    },
  }
}
