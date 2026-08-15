import type { PreviewManifest } from "@blame/preview-contract";
import { parseDeploymentManifest } from "./parser.js";
import type { DeploymentDiagnostic, DeploymentManifest } from "./types.js";

export type DeploymentRunConfiguration = {
  id: string;
  command: string;
  cwd: string;
  default: boolean;
  category: "web" | "mobile" | "desktop" | "terminal" | "service" | "other";
  services: string[];
  previewService?: string | null;
  scopes: string[];
};

export function deriveDeploymentManifest(input: {
  previewManifest: PreviewManifest;
  runConfigurations: DeploymentRunConfiguration[];
}): DeploymentManifest {
  const web = input.runConfigurations.filter(
    ({ category }) => category === "web",
  );
  const selected = selectWebConfiguration(web);
  const blockers: DeploymentDiagnostic[] = [];
  const warnings: DeploymentDiagnostic[] = [];

  if (!web.length) {
    blockers.push({
      code: "DEPLOY_WEB_TARGET_MISSING",
      message:
        "This project does not expose a web target that Vercel can deploy.",
      action: "Run project initialization again.",
    });
  } else if (!selected) {
    blockers.push({
      code: "DEPLOY_ROOT_AMBIGUOUS",
      message:
        "Several web targets were detected and none is selected as the default.",
      action: "Choose one web target during project initialization.",
    });
  }

  const service = input.previewManifest.services.find(
    ({ id }) => id === selected?.previewService,
  );
  if (selected && !service) {
    blockers.push({
      code: "DEPLOY_WEB_TARGET_MISSING",
      message:
        "The selected web target no longer matches the project initialization.",
      action: "Run project initialization again.",
    });
  }

  for (const dependency of selectedDependencies(
    input.previewManifest,
    selected,
  )) {
    const image = dependency.container.image?.toLowerCase() ?? "";
    const database =
      /(?:postgres|mysql|mariadb|mongo|redis|cockroach|sqlite)/.test(image);
    if (database) {
      blockers.push({
        code: "DEPLOY_LOCAL_DATABASE_REQUIRED",
        message: `The web target depends on local service “${dependency.id}”, which Vercel cannot provision.`,
        action:
          "Configure a hosted database in Vercel and remove the local runtime dependency.",
      });
    } else if (dependency.kind === "worker") {
      blockers.push({
        code: "DEPLOY_PERSISTENT_WORKER_REQUIRED",
        message: `The web target requires persistent worker “${dependency.id}”.`,
        action:
          "Move the worker to a supported external service before deploying.",
      });
    } else if (
      dependency.endpoints.some(({ protocol }) => protocol === "tcp")
    ) {
      blockers.push({
        code: "DEPLOY_LOCAL_SERVICE_REQUIRED",
        message: `The web target depends on local TCP service “${dependency.id}”.`,
        action: "Configure an externally hosted service before deploying.",
      });
    }
  }

  if (service?.command && /(?:websocket|\bws\b)/i.test(service.command)) {
    blockers.push({
      code: "DEPLOY_WEBSOCKET_UNSUPPORTED",
      message:
        "The selected web target appears to require a persistent WebSocket server.",
      action:
        "Use a Vercel-compatible realtime provider or another hosting target.",
    });
  }

  const requiredEnvironmentKeys = Array.from(
    new Set([
      ...Object.keys(service?.environment ?? {}),
      ...(service?.bindings ?? []).map(({ target }) => target.key),
    ]),
  ).sort();
  if (requiredEnvironmentKeys.length) {
    warnings.push({
      code: "DEPLOY_ENVIRONMENT_REQUIRED",
      message: `${requiredEnvironmentKeys.length} environment ${requiredEnvironmentKeys.length === 1 ? "variable is" : "variables are"} required in Vercel.`,
      action: "Configure the required keys in the Vercel project settings.",
    });
  }

  const rootDirectory =
    selected?.cwd || input.previewManifest.project.root || ".";
  const framework = frameworkFromStack(
    input.previewManifest.project.detectedStack ?? [],
  );
  return parseDeploymentManifest({
    provider: "vercel",
    rootDirectory,
    framework,
    runConfigurationId: selected?.id,
    previewServiceId: selected?.previewService ?? undefined,
    requiredEnvironmentKeys,
    compatibility: {
      status: blockers.length
        ? "unsupported"
        : warnings.length
          ? "conditional"
          : "supported",
      blockers: uniqueDiagnostics(blockers),
      warnings: uniqueDiagnostics(warnings),
    },
  });
}

function selectWebConfiguration(configurations: DeploymentRunConfiguration[]) {
  if (configurations.length === 1) return configurations[0];
  const defaults = configurations.filter(({ default: isDefault }) => isDefault);
  return defaults.length === 1 ? defaults[0] : undefined;
}

function selectedDependencies(
  manifest: PreviewManifest,
  configuration: DeploymentRunConfiguration | undefined,
) {
  if (!configuration) return [];
  return manifest.services.filter(
    ({ id }) =>
      id !== configuration.previewService &&
      configuration.services.includes(id),
  );
}

function frameworkFromStack(stack: string[]) {
  const normalized = stack.map((item) => item.toLowerCase());
  const candidates: Array<[RegExp, string]> = [
    [/next(?:\.js|js)?/, "nextjs"],
    [/svelte(?:kit)?/, "sveltekit"],
    [/nuxt/, "nuxtjs"],
    [/remix/, "remix"],
    [/astro/, "astro"],
    [/gatsby/, "gatsby"],
    [/angular/, "angular"],
    [/vite/, "vite"],
  ];
  for (const [pattern, framework] of candidates) {
    if (normalized.some((item) => pattern.test(item))) return framework;
  }
  return null;
}

function uniqueDiagnostics(diagnostics: DeploymentDiagnostic[]) {
  return diagnostics.filter(
    ({ code }, index) =>
      diagnostics.findIndex((item) => item.code === code) === index,
  );
}
