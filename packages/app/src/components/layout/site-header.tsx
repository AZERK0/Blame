import * as React from "react"
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react"

import { usePlatform, type WindowControlsClient } from "@/context/platform"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function SiteHeader({ title }: { title: string }) {
  const platform = usePlatform()

  return (
    <header
      data-window-drag
      className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="truncate text-base font-medium">{title}</h1>
      </div>
      {platform.windowControls ? (
        <WindowControls controls={platform.windowControls} />
      ) : null}
    </header>
  )
}

function WindowControls({ controls }: { controls: WindowControlsClient }) {
  const [maximized, setMaximized] = React.useState(false)

  React.useEffect(() => {
    let mounted = true
    void controls.isMaximized().then((value) => {
      if (mounted) setMaximized(value)
    })
    const removeListener = controls.onMaximized(setMaximized)
    return () => {
      mounted = false
      removeListener()
    }
  }, [controls])

  return (
    <div className="mr-2 flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Minimize"
        aria-label="Minimize"
        onClick={() => void controls.minimize()}
      >
        <MinusIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title={maximized ? "Restore" : "Maximize"}
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => void controls.toggleMaximize()}
      >
        {maximized ? <CopyIcon /> : <SquareIcon />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Close"
        aria-label="Close"
        onClick={controls.close}
      >
        <XIcon />
      </Button>
    </div>
  )
}
