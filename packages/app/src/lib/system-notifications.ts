import * as React from "react"

import type { Platform, SystemNotificationInput } from "@/context/platform"

const storageKey = "blame.system-notifications-enabled.v1"
const changeEvent = "blame-system-notifications-enabled-change"

export function useSystemNotificationsEnabled() {
  const [enabled, setEnabledState] = React.useState(systemNotificationsEnabled)

  React.useEffect(() => {
    const update = () => setEnabledState(systemNotificationsEnabled())
    window.addEventListener("storage", update)
    window.addEventListener(changeEvent, update)
    return () => {
      window.removeEventListener("storage", update)
      window.removeEventListener(changeEvent, update)
    }
  }, [])

  const setEnabled = React.useCallback((nextEnabled: boolean) => {
    setSystemNotificationsEnabled(nextEnabled)
  }, [])

  return [enabled, setEnabled] as const
}

export function showSystemNotification(
  platform: Pick<Platform, "systemNotifications">,
  input: SystemNotificationInput
) {
  if (
    !shouldShowSystemNotification(
      systemNotificationsEnabled(),
      document.hasFocus()
    )
  ) {
    return Promise.resolve(false)
  }
  return (
    platform.systemNotifications?.show(input).catch(() => false) ??
    Promise.resolve(false)
  )
}

export function shouldShowSystemNotification(
  enabled: boolean,
  appFocused: boolean
) {
  return enabled && !appFocused
}

function systemNotificationsEnabled() {
  return localStorage.getItem(storageKey) !== "false"
}

function setSystemNotificationsEnabled(enabled: boolean) {
  localStorage.setItem(storageKey, enabled ? "true" : "false")
  window.dispatchEvent(new Event(changeEvent))
}
