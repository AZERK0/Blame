import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const downloadBaseUrl = text(process.env.BLAME_DOWNLOAD_BASE_URL)
const homepage = text(process.env.BLAME_HOMEPAGE) ?? "https://blame.dev"
const maintainerEmail = text(process.env.BLAME_MAINTAINER_EMAIL) ?? "hello@blame.dev"
const maintainerName = text(process.env.BLAME_MAINTAINER_NAME) ?? "Blame"
const releaseVersion = text(process.env.BLAME_VERSION)

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

async function removeMacosExtendedAttributes(context: PackContext) {
  if (context.electronPlatformName !== "darwin") return
  await execFileAsync("xattr", ["-cr", context.appOutDir])
  console.log(`Removed macOS extended attributes from ${context.appOutDir}`)
}

const config: Configuration = {
  afterPack: removeMacosExtendedAttributes,
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
