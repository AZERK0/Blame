import * as React from "react"
import type { BundledLanguage } from "shiki"

import {
  highlightCode,
  languageFromPath,
} from "@/components/backlog/development/development-code-highlighting"
import { sanitizeHtml } from "@/lib/sanitize-html"
import { cn } from "@/lib/utils"

export function DevelopmentHighlightedCode({
  className,
  code,
  language,
  path,
}: {
  className?: string
  code: string
  language?: BundledLanguage
  path?: string
}) {
  const resolvedLanguage = language ?? languageFromPath(path)
  const [result, setResult] = React.useState<HighlightedCodeResult>()
  const html =
    result?.code === code && result.language === resolvedLanguage ? result.html : undefined

  React.useEffect(() => {
    let cancelled = false
    highlightCode(code, resolvedLanguage).then((next) => {
      if (!cancelled) setResult({ code, html: next, language: resolvedLanguage })
    })
    return () => {
      cancelled = true
    }
  }, [code, resolvedLanguage])

  if (!html) {
    return (
      <pre className={cn("w-max min-w-full p-4 font-mono text-xs leading-5", className)}>
        <code>{code || " "}</code>
      </pre>
    )
  }

  return (
    <div
      className={cn("development-code-highlight", className)}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  )
}

type HighlightedCodeResult = {
  code: string
  html: string
  language: BundledLanguage
}
