import * as React from "react"

import { cn } from "@/lib/utils"

type FileIconNode = {
  path: string
  type: "directory" | "file"
}

const sprite = new URL(
  "../../../../../ui/src/components/file-icons/sprite.svg",
  import.meta.url
).href

const fileNames: Record<string, string> = {
  ".babelrc": "Babel",
  ".dockerignore": "Docker",
  ".editorconfig": "Editorconfig",
  ".env": "Tune",
  ".env.development": "Tune",
  ".env.example": "Tune",
  ".env.local": "Tune",
  ".env.production": "Tune",
  ".eslintrc": "Eslint",
  ".eslintrc.js": "Eslint",
  ".eslintrc.json": "Eslint",
  ".gitignore": "Git",
  ".nvmrc": "Nodejs",
  ".node-version": "Nodejs",
  ".prettierrc": "Prettier",
  ".prettierrc.js": "Prettier",
  ".prettierrc.json": "Prettier",
  "angular.json": "Angular",
  "astro.config.js": "AstroConfig",
  "astro.config.mjs": "AstroConfig",
  "bun.lock": "Bun",
  "bun.lockb": "Bun",
  "bunfig.toml": "Bun",
  "cargo.toml": "Rust",
  "changelog.md": "Changelog",
  "composer.json": "Php",
  "contributing.md": "Contributing",
  "deno.json": "Deno",
  "deno.jsonc": "Deno",
  "docker-compose.yaml": "Docker",
  "docker-compose.yml": "Docker",
  dockerfile: "Docker",
  "favicon.ico": "Favicon",
  "go.mod": "GoMod",
  "go.sum": "GoMod",
  license: "Certificate",
  makefile: "Makefile",
  "next.config.js": "Next",
  "next.config.mjs": "Next",
  "package-lock.json": "Nodejs",
  "package.json": "Nodejs",
  "playwright.config.js": "Playwright",
  "playwright.config.ts": "Playwright",
  "pnpm-lock.yaml": "Pnpm",
  "pyproject.toml": "Python",
  "readme.md": "Readme",
  "requirements.txt": "Python",
  "svelte.config.js": "Svelte",
  "tailwind.config.js": "Tailwindcss",
  "tailwind.config.ts": "Tailwindcss",
  "tsconfig.json": "Tsconfig",
  "turbo.json": "Turborepo",
  "vite.config.js": "Vite",
  "vite.config.ts": "Vite",
  "vitest.config.js": "Vitest",
  "vitest.config.ts": "Vitest",
  "yarn.lock": "Yarn",
}

const fileExtensions: Record<string, string> = {
  "7z": "Zip",
  astro: "Astro",
  avi: "Video",
  bash: "Console",
  bmp: "Image",
  c: "C",
  cfg: "Settings",
  cjs: "Javascript",
  clj: "Clojure",
  cljs: "Clojure",
  conf: "Settings",
  cpp: "Cpp",
  crt: "Certificate",
  cs: "Csharp",
  css: "Css",
  csv: "Document",
  dart: "Dart",
  db: "Database",
  doc: "Word",
  docx: "Word",
  env: "Tune",
  ex: "Elixir",
  exs: "Elixir",
  fish: "Console",
  flac: "Audio",
  fs: "Fsharp",
  gif: "Image",
  go: "Go",
  gql: "Graphql",
  graphql: "Graphql",
  gz: "Zip",
  h: "H",
  hpp: "Hpp",
  htm: "Html",
  html: "Html",
  ico: "Favicon",
  ini: "Settings",
  java: "Java",
  jl: "Julia",
  jpeg: "Image",
  jpg: "Image",
  js: "Javascript",
  "js.map": "JavascriptMap",
  json: "Json",
  jsonc: "Json",
  jsx: "React",
  key: "Key",
  kt: "Kotlin",
  less: "Less",
  lock: "Lock",
  log: "Log",
  lua: "Lua",
  m: "ObjectiveC",
  md: "Markdown",
  mdx: "Mdx",
  mjs: "Javascript",
  mm: "ObjectiveCpp",
  mov: "Video",
  mp3: "Audio",
  mp4: "Video",
  pdf: "Pdf",
  pem: "Certificate",
  php: "Php",
  png: "Image",
  ppt: "Powerpoint",
  pptx: "Powerpoint",
  proto: "Proto",
  ps1: "Powershell",
  py: "Python",
  r: "R",
  rar: "Zip",
  rb: "Ruby",
  rs: "Rust",
  sass: "Sass",
  scss: "Sass",
  sh: "Console",
  sql: "Database",
  sqlite: "Database",
  svg: "Svg",
  svelte: "Svelte",
  tar: "Zip",
  tex: "Tex",
  toml: "Toml",
  ts: "Typescript",
  "d.ts": "TypescriptDef",
  tsx: "React_ts",
  vb: "Visualstudio",
  vue: "Vue",
  wav: "Audio",
  wasm: "Webassembly",
  webm: "Video",
  webp: "Image",
  xlsx: "Document",
  xml: "Xml",
  yaml: "Yaml",
  yml: "Yaml",
  zip: "Zip",
  zig: "Zig",
  zsh: "Console",
}

const folderNames: Record<string, string> = {
  ".github": "FolderGithub",
  ".gitlab": "FolderGitlab",
  ".idea": "FolderIntellij",
  ".vscode": "FolderVscode",
  android: "FolderAndroid",
  api: "FolderApi",
  assets: "FolderImages",
  auth: "FolderSecure",
  build: "FolderBuildkite",
  components: "FolderComponents",
  config: "FolderConfig",
  cypress: "FolderCypress",
  data: "FolderDatabase",
  db: "FolderDatabase",
  desktop: "FolderDesktop",
  dist: "FolderDist",
  docker: "FolderDocker",
  docs: "FolderDocs",
  e2e: "FolderTest",
  fonts: "FolderFont",
  hooks: "FolderHook",
  images: "FolderImages",
  infra: "FolderTerraform",
  ios: "FolderIos",
  lib: "FolderLib",
  locales: "FolderI18n",
  middleware: "FolderMiddleware",
  migrations: "FolderDatabase",
  node_modules: "FolderNode",
  packages: "FolderPackages",
  pages: "FolderViews",
  prisma: "FolderPrisma",
  public: "FolderPublic",
  routes: "FolderRoutes",
  script: "FolderScripts",
  scripts: "FolderScripts",
  src: "FolderSrc",
  static: "FolderPublic",
  store: "FolderStore",
  styles: "FolderCss",
  test: "FolderTest",
  tests: "FolderTest",
  types: "FolderTypescript",
  utils: "FolderUtils",
  vendor: "FolderPackages",
  views: "FolderViews",
  workflows: "FolderGhWorkflows",
}

export function DevelopmentFileIcon({
  className,
  expanded,
  mono,
  node,
}: {
  className?: string
  expanded?: boolean
  mono?: boolean
  node: FileIconNode
}) {
  const icon = iconName(node.path, node.type, Boolean(expanded))
  const maskId = React.useId()

  return (
    <svg className={cn("size-4", className)} data-component="file-icon">
      {mono ? (
        <>
          <defs>
            <mask id={maskId} mask-type="alpha">
              <use href={`${sprite}#${icon}`} />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="currentColor" mask={`url(#${maskId})`} />
        </>
      ) : (
        <use href={`${sprite}#${icon}`} />
      )}
    </svg>
  )
}

function iconName(path: string, type: FileIconNode["type"], expanded: boolean) {
  const basename = basenameOf(path).toLowerCase()
  if (type === "directory") return folderIconName(basename, expanded)
  return fileNames[basename] ?? extensionIconName(basename) ?? "Document"
}

function folderIconName(name: string, expanded: boolean) {
  const icon = folderNames[name] ?? folderNames[name.replace(/^[_\\.]+/, "")] ?? "Folder"
  if (!expanded) return icon
  if (icon.endsWith("Open")) return icon
  if (icon.endsWith("_light")) return icon.replace("_light", "Open_light")
  return `${icon}Open`
}

function extensionIconName(name: string) {
  return dottedSuffixes(name).map((extension) => fileExtensions[extension]).find(Boolean)
}

function dottedSuffixes(name: string) {
  const suffixes = new Set([name])
  name.split(".").forEach((_, index, parts) => {
    if (index > 0) suffixes.add(parts.slice(index).join("."))
  })
  return [...suffixes].sort((left, right) => right.length - left.length)
}

function basenameOf(path: string) {
  return path.split("\\").join("/").split("/").filter(Boolean).pop() ?? ""
}
