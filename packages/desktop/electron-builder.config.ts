import { execFile } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const downloadBaseUrl = text(process.env.BLAME_DOWNLOAD_BASE_URL)
const homepage = text(process.env.BLAME_HOMEPAGE) ?? "https://blame.dev"
const maintainerEmail =
  text(process.env.BLAME_MAINTAINER_EMAIL) ?? "hello@blame.dev"
const maintainerName = text(process.env.BLAME_MAINTAINER_NAME) ?? "Blame"
const releaseVersion = text(process.env.BLAME_VERSION)
const projectDir = dirname(fileURLToPath(import.meta.url))
const macosInheritedEntitlements = join(
  projectDir,
  "resources/runtime/macos/entitlements.inherit.plist",
)

const publish = downloadBaseUrl
  ? {
      provider: "generic" as const,
      url: downloadBaseUrl,
    }
  : undefined

function text(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

type PackContext = {
  appOutDir: string
  electronPlatformName: string
  packager: {
    appInfo: {
      productFilename: string
    }
  }
}

async function finalizePackage(context: PackContext) {
  if (context.electronPlatformName !== "darwin") return
  await execFileAsync("xattr", ["-cr", context.appOutDir])
  console.log(`Removed macOS extended attributes from ${context.appOutDir}`)
  await assertMacosRuntimeArchitecture(context)
}

async function assertMacosRuntimeArchitecture(context: PackContext) {
  const appRoot = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )
  const appExecutable = join(
    appRoot,
    "Contents/MacOS",
    context.packager.appInfo.productFilename,
  )
  const limaExecutable = join(
    appRoot,
    "Contents/Resources/runtime/macos/lima/bundle/bin/limactl",
  )
  const [appArchitecture, limaArchitecture] = await Promise.all([
    executableArchitecture(appExecutable),
    executableArchitecture(limaExecutable),
  ])
  if (appArchitecture !== limaArchitecture) {
    throw new Error(
      `macOS runtime architecture mismatch: app is ${appArchitecture}, Lima is ${limaArchitecture}.`,
    )
  }
}

async function executableArchitecture(executable: string) {
  const { stdout } = await execFileAsync("lipo", ["-archs", executable])
  const architectures = stdout.trim().split(/\s+/)
  if (architectures.includes("arm64")) return "arm64"
  if (architectures.includes("x86_64")) return "x86_64"
  throw new Error(
    `Unsupported macOS executable architecture for ${executable}: ${stdout.trim()}`,
  )
}

const config: Configuration = {
  afterPack: finalizePackage,
  appId: "dev.blame.desktop",
  productName: "Blame",
  protocols: [{ name: "Blame", schemes: ["blame"] }],
  artifactName: "blame-${os}-${arch}.${ext}",
  directories: {
    buildResources: ".",
    output: "dist",
  },
  extraMetadata: {
    author: {
      email: maintainerEmail,
      name: maintainerName,
    },
    description: "Agentic desktop IDE for controlled AI development workflows.",
    homepage,
    ...(releaseVersion ? { version: releaseVersion } : {}),
  },
  extraResources: [
    {
      from: "resources/runtime",
      to: "runtime",
    },
  ],
  files: ["out/**/*", "icons/prod/**/*", "package.json"],
  linux: {
    category: "Development",
    icon: "icons/prod",
    maintainer: `${maintainerName} <${maintainerEmail}>`,
    target: ["AppImage", "deb", "rpm"],
  },
  mac: {
    category: "public.app-category.developer-tools",
    entitlementsInherit: macosInheritedEntitlements,
    icon: "icons/prod/icon.icns",
    target: ["dmg", "zip"],
  },
  nsis: {
    allowToChangeInstallationDirectory: true,
    installerHeaderIcon: "icons/prod/icon.ico",
    installerIcon: "icons/prod/icon.ico",
    oneClick: false,
  },
  publish,
  win: {
    icon: "icons/prod/icon.ico",
    target: ["nsis"],
  },
}

export default config
