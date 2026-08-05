import * as React from "react"
import { getFiletypeFromFileName, preloadHighlighter } from "@pierre/diffs"

const pierreThemes = ["github-dark", "github-light"] as const
const loadedLanguages = new Set<string>()
const pendingLanguages = new Map<string, Promise<void>>()

function preloadLanguage(language: string) {
  const key = `${language}:${pierreThemes.join(",")}`

  if (loadedLanguages.has(key)) return Promise.resolve()

  const pending = pendingLanguages.get(key)
  if (pending) return pending

  const request = preloadHighlighter({
    langs: [language],
    themes: [...pierreThemes],
  })
    .then(() => {
      loadedLanguages.add(key)
      pendingLanguages.delete(key)
    })
    .catch((error) => {
      pendingLanguages.delete(key)
      throw error
    })

  pendingLanguages.set(key, request)
  return request
}

export function usePierreSyntaxHighlighting(path: string) {
  const language = getFiletypeFromFileName(path)
  const key = `${language}:${pierreThemes.join(",")}`
  const [readyKey, setReadyKey] = React.useState(() =>
    loadedLanguages.has(key) ? key : undefined
  )

  React.useEffect(() => {
    let active = true

    void preloadLanguage(language)
      .catch(() => {
        // Pierre can still render a readable plain-text fallback if a grammar
        // is unavailable, so a failed preload must not block the file preview.
      })
      .then(() => {
        if (active) setReadyKey(key)
      })

    return () => {
      active = false
    }
  }, [key, language])

  return readyKey === key
}
