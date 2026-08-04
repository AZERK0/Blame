import * as React from "react"
import {
  resolveRuntimePreference,
  type RuntimePreference,
  type RuntimeProfileId,
} from "@blame/preview-runtime"

const storageKey = "blame.runtime-preference.v1"
const activeSessionsKey = "blame.runtime-active-sessions.v1"
const eventName = "blame:runtime-preference"
let cachedRaw: string | null | undefined
let cachedPreference: RuntimePreference = resolveRuntimePreference({})
const defaultRuntimePreference: RuntimePreference = {
  profile: "local-container",
  source: "account-default",
}

export function readRuntimePreference(): RuntimePreference {
  const raw = localStorage.getItem(storageKey)
  if (raw === cachedRaw) return cachedPreference
  cachedRaw = raw
  try {
    const value = JSON.parse(raw ?? "null") as Partial<RuntimePreference> | null
    if (
      value &&
      ["local-container", "vercel-compose"].includes(value.profile ?? "")
    ) {
      cachedPreference = {
        profile: value.profile as RuntimeProfileId,
        source: "account-default",
        ...(value.confirmedCloudUploadAt
          ? { confirmedCloudUploadAt: value.confirmedCloudUploadAt }
          : {}),
      }
      return cachedPreference
    }
  } catch {
    cachedRaw = undefined
  }
  if (raw !== null) localStorage.removeItem(storageKey)
  cachedRaw = null
  cachedPreference = resolveRuntimePreference({})
  return cachedPreference
}

export function saveRuntimePreference(preference: RuntimePreference) {
  localStorage.setItem(storageKey, JSON.stringify(preference))
  cachedRaw = undefined
  window.dispatchEvent(new Event(eventName))
}

export function recordRuntimeSessionState(
  storyId: string,
  profile: RuntimeProfileId,
  stopped: boolean
) {
  const entries = activeRuntimeSessions()
  if (stopped) delete entries[storyId]
  else entries[storyId] = { profile, updatedAt: Date.now() }
  localStorage.setItem(activeSessionsKey, JSON.stringify(entries))
}

export function runtimeProfileSwitchBlockReason(profile: RuntimeProfileId) {
  const active = Object.values(activeRuntimeSessions()).find(
    (entry) => entry.profile !== profile
  )
  return active
    ? "Stop the active preview before changing runtime profile."
    : undefined
}

export function useRuntimePreference(): RuntimePreference {
  return React.useSyncExternalStore(
    (callback) => {
      window.addEventListener(eventName, callback)
      window.addEventListener("storage", callback)
      return () => {
        window.removeEventListener(eventName, callback)
        window.removeEventListener("storage", callback)
      }
    },
    readRuntimePreference,
    () => defaultRuntimePreference
  )
}

function activeRuntimeSessions() {
  const maximumAgeMs = 24 * 60 * 60_000
  try {
    const value = JSON.parse(
      localStorage.getItem(activeSessionsKey) ?? "{}"
    ) as Record<string, { profile?: unknown; updatedAt?: unknown }>
    const active = Object.fromEntries(
      Object.entries(value).flatMap(([storyId, entry]) =>
        typeof entry.profile === "string" &&
        ["local-container", "vercel-compose"].includes(entry.profile) &&
        typeof entry.updatedAt === "number" &&
        Date.now() - entry.updatedAt <= maximumAgeMs
          ? [
              [
                storyId,
                {
                  profile: entry.profile as RuntimeProfileId,
                  updatedAt: entry.updatedAt,
                },
              ],
            ]
          : []
      )
    )
    if (Object.keys(active).length) {
      localStorage.setItem(activeSessionsKey, JSON.stringify(active))
    } else {
      localStorage.removeItem(activeSessionsKey)
    }
    return active
  } catch {
    localStorage.removeItem(activeSessionsKey)
    return {} as Record<
      string,
      { profile: RuntimeProfileId; updatedAt: number }
    >
  }
}
