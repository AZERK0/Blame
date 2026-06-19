import { generatePreviewArtifacts } from "./preview-manifest.js"
import type {
  PreviewManifest,
  ProjectInitializationDiagnostics,
  ProjectInitializationImpactDiagnostics,
  ProjectRunConfiguration,
  RepairProjectInitializationInput,
  RepairProjectInitializationResult,
} from "./types.js"

type KnownRepairInput = Pick<
  RepairProjectInitializationInput,
  | "diagnostics"
  | "dockerCompose"
  | "previewManifest"
  | "runConfigurations"
  | "setupScript"
>

export function repairKnownProjectInitializationFailure(
  input: KnownRepairInput,
): RepairProjectInitializationResult | null {
  if (!isNextTurbopackRootFailure(input.diagnostics)) return null
  const previewManifest = repairedPreviewManifest(input.previewManifest)
  const runConfigurations = repairedRunConfigurations(input.runConfigurations)
  if (previewManifest) {
    const generated = generatePreviewArtifacts(previewManifest)
    return knownRepairResult(
      previewManifest,
      generated.dockerCompose,
      generated.setupScript,
      runConfigurations,
    )
  }
  const dockerCompose = commandWithWebpackFallback(input.dockerCompose)
  if (dockerCompose === input.dockerCompose) return null
  return knownRepairResult(
    undefined,
    dockerCompose,
    input.setupScript,
    runConfigurations,
  )
}

function knownRepairResult(
  previewManifest: PreviewManifest | undefined,
  dockerCompose: string,
  setupScript: string,
  runConfigurations: ProjectRunConfiguration[],
): RepairProjectInitializationResult {
  return {
    sessionId: "local-next-turbopack-root-repair",
    classification: "repairable_initialization",
    reason:
      "Next.js Turbopack inferred an invalid workspace root in the preview container, so Blame will run the development preview through Webpack for this project.",
    previewManifest,
    setupScript,
    dockerCompose,
    runConfigurations,
  }
}

function repairedPreviewManifest(manifest: PreviewManifest | undefined) {
  if (!manifest) return undefined
  const services = manifest.services.map((service) => ({
    ...service,
    command:
      service.kind === "preview" && service.command
        ? commandWithWebpackFallback(service.command)
        : service.command,
  }))
  const changed = services.some(
    (service, index) => service.command !== manifest.services[index]?.command,
  )
  if (!changed) {
    return undefined
  }
  return { ...manifest, services }
}

function repairedRunConfigurations(configurations: ProjectRunConfiguration[]) {
  return configurations.map((configuration) => ({
    ...configuration,
    command: commandWithWebpackFallback(configuration.command),
  }))
}

function isNextTurbopackRootFailure(
  diagnostics:
    | ProjectInitializationDiagnostics
    | ProjectInitializationImpactDiagnostics,
) {
  const text = diagnosticText(diagnostics)
  return (
    text.includes("Next.js inferred your workspace root") &&
    text.includes("turbopack.root") &&
    text.includes("next/package.json")
  )
}

function diagnosticText(
  diagnostics:
    | ProjectInitializationDiagnostics
    | ProjectInitializationImpactDiagnostics,
) {
  return Object.values(diagnostics)
    .flatMap((value) =>
      typeof value === "string" ? [value] : Object.values(value ?? {}),
    )
    .filter((value): value is string => typeof value === "string")
    .join("\n")
}

function commandWithWebpackFallback(command: string) {
  if (/\s--(?:webpack|turbo|turbopack)\b/.test(command)) return command
  const direct = commandWithDirectNextWebpack(command)
  if (direct !== command) return direct
  return commandWithPackageManagerWebpack(command)
}

function commandWithDirectNextWebpack(command: string) {
  return command.replace(
    /\b(next\s+dev)(?=(?:\s*(?:&&|\|\||;)|["')\]]|\s*$))/,
    "$1 --webpack",
  )
}

function commandWithPackageManagerWebpack(command: string) {
  return command.replace(
    /\b((?:(?:corepack|bun)\s+)?(?:pnpm|npm|bun|yarn)(?:\s+(?!--webpack|--turbo|--turbopack|&&|\|\||;)[^\s;&|]+)*\s+(?:run\s+)?dev)(?=(?:\s*(?:&&|\|\||;)|["')\]]|\s*$))/,
    (match) => `${match}${packageManagerArgumentSeparator(match)}--webpack`,
  )
}

function packageManagerArgumentSeparator(command: string) {
  if (/\b(?:pnpm|yarn|corepack\s+(?:pnpm|yarn))\b/.test(command)) return " "
  return " -- "
}
