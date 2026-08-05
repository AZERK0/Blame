import * as React from "react"
import type { BundledLanguage } from "shiki"

const languageByExtension: Record<string, BundledLanguage> = {
  astro: "astro",
  bash: "bash",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  lua: "lua",
  md: "markdown",
  mdx: "mdx",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shellscript",
  sql: "sql",
  svelte: "svelte",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
  zsh: "shellscript",
}

const languageByName: Record<string, BundledLanguage> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
}

export function useHighlightedCodeLines({
  code,
  language,
  path,
}: {
  code: string
  language?: BundledLanguage
  path?: string
}) {
  const resolvedLanguage = language ?? languageFromPath(path)
  const [result, setResult] = React.useState<HighlightedLinesResult>()
  const lines =
    result?.code === code && result.language === resolvedLanguage ? result.lines : undefined

  React.useEffect(() => {
    let cancelled = false
    highlightedCodeLines(code, resolvedLanguage).then((next) => {
      if (!cancelled) setResult({ code, language: resolvedLanguage, lines: next })
    })
    return () => {
      cancelled = true
    }
  }, [code, resolvedLanguage])

  return lines
}

export function languageFromPath(path?: string): BundledLanguage {
  if (!path) return "plaintext" as BundledLanguage
  const name = path.split("/").pop()?.toLowerCase() ?? ""
  const direct = languageByName[name]
  if (direct) return direct
  const extension = name.split(".").pop() ?? ""
  return languageByExtension[extension] ?? ("plaintext" as BundledLanguage)
}

export async function highlightCode(code: string, language: BundledLanguage) {
  const shiki = await import("shiki")
  return shiki.codeToHtml(code || " ", {
    lang: language,
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    defaultColor: false,
  })
}

async function highlightedCodeLines(code: string, language: BundledLanguage) {
  const sourceLines = sourceCodeLines(code)
  const html = await highlightCode(code, language)
  const document = new DOMParser().parseFromString(html, "text/html")
  const shikiLines = Array.from(document.querySelectorAll(".line")).map(
    (line) => line.innerHTML
  )
  return sourceLines.map((line, index) => shikiLines[index] ?? escapeHtml(line || " "))
}

export function sourceCodeLines(code: string) {
  return (code || " ").split("\n")
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

type HighlightedLinesResult = {
  code: string
  language: BundledLanguage
  lines: string[]
}
