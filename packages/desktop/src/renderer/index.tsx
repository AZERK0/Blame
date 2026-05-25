import { mountApp } from "@blame/app"
import "./styles.css"

const root = document.getElementById("root")
if (!(root instanceof HTMLElement)) throw new Error("Root element not found")

mountApp(root, {
  platform: {
    agent: window.blame.agent,
    previewBrowser: window.blame.previewBrowser,
    terminal: window.blame.terminal,
    workspace: window.blame.workspace,
    openDirectoryPickerDialog: (options) => window.blame.openDirectoryPicker(options),
    openExternalLink: (url) => window.blame.openExternalLink(url),
    openPath: (path) => window.blame.openPath(path),
  },
})
