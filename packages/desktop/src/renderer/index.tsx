import { mountApp } from "@blame/app"
import "./styles.css"

document.documentElement.dataset.blameDesktop = "true"

const root = document.getElementById("root")
if (!(root instanceof HTMLElement)) throw new Error("Root element not found")

mountApp(root, {
  platform: {
    agent: window.blame.agent,
    platform: window.blame.platform,
    previewBrowser: window.blame.previewBrowser,
    terminal: window.blame.terminal,
    updates: window.blame.updates,
    workspace: window.blame.workspace,
    windowControls: window.blame.windowControls,
    openDirectoryPickerDialog: (options) => window.blame.openDirectoryPicker(options),
    openExternalLink: (url) => window.blame.openExternalLink(url),
    openPath: (path) => window.blame.openPath(path),
  },
})
