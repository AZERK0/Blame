import * as React from "react"

import { WindowControls } from "@/components/layout/site-header"
import { SettingsDialog, SettingsDialogButton } from "@/pages/settings/page"

export function CompactWindowChrome({
  settings = true,
}: {
  settings?: boolean
}) {
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  return (
    <>
      <div data-compact-window-drag className="fixed inset-x-0 top-0 z-40 h-11">
        <WindowControls
          className="absolute top-2 right-3"
          showMaximize={false}
        />
      </div>
      {settings ? (
        <SettingsDialogButton
          className="fixed bottom-4 left-4 z-40"
          onClick={() => setSettingsOpen(true)}
        />
      ) : null}
      {settings ? (
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      ) : null}
    </>
  )
}
