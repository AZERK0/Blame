import type {
  PreviewManifest,
  PreviewManifestService,
  PreviewLifecycleState,
  ProjectRunConfiguration,
  ProjectRunConfigurationStatus,
} from "@blame/agent-runtime";

export type PreviewRuntimeSelectionState = {
  desiredStatus: "running" | "stopped";
  lifecycle?: PreviewLifecycleState;
  selectedConfigurationId?: string;
};

export type PreviewRuntimeContainerState = {
  exitCode?: number;
  health?: string;
  service: string;
  status?: string;
};

export function initialPreviewRuntimeSelection(
  configurations: ProjectRunConfiguration[],
  requestedId: string | null | undefined,
): PreviewRuntimeSelectionState {
  const requested = configurations.find(({ id }) => id === requestedId);
  const selected =
    requested ??
    configurations.find(({ default: isDefault }) => isDefault) ??
    configurations[0];
  return {
    desiredStatus: requested ? "running" : "stopped",
    ...(selected ? { selectedConfigurationId: selected.id } : {}),
  };
}

export function selectedPreviewRunConfiguration(
  configurations: ProjectRunConfiguration[],
  state: PreviewRuntimeSelectionState,
) {
  return (
    configurations.find(({ id }) => id === state.selectedConfigurationId) ??
    configurations.find(({ default: isDefault }) => isDefault) ??
    configurations[0]
  );
}

export function shouldStartBrowserPreview(
  configurations: ProjectRunConfiguration[],
  state: PreviewRuntimeSelectionState,
  manifest: PreviewManifest | undefined,
) {
  if (state.desiredStatus !== "running") return false;
  const selected = selectedPreviewRunConfiguration(configurations, state);
  if (!manifest || !selected) return false;
  if (selected.category && selected.category !== "web") return false;
  return manifest.services.some(
    (service) =>
      service.id === selected.previewService && browserPreviewService(service),
  );
}

export function selectedPreviewRuntimeServiceIds(
  configurations: ProjectRunConfiguration[],
  state: PreviewRuntimeSelectionState,
  runtimeServiceIds: string[],
  manifest?: PreviewManifest,
) {
  const selected = selectedPreviewRunConfiguration(configurations, state);
  if (!selected) return [];
  const runtimeServices = new Set(runtimeServiceIds);
  if (selected && hostOnlyRunConfiguration(selected)) return [];
  const selectedServices = manifest
    ? previewRunConfigurationServiceIds(selected, manifest)
    : (selected.services ?? []);
  return selectedServices.filter((service) => runtimeServices.has(service));
}

export function normalizeStoredRunConfigurations(
  configurations: ProjectRunConfiguration[],
  manifest: PreviewManifest | undefined,
) {
  if (!manifest) return configurations;
  return configurations.map((configuration) =>
    normalizeStoredRunConfiguration(configuration, manifest),
  );
}

export function previewRunConfigurationStatus(
  configuration: ProjectRunConfiguration,
  containers: PreviewRuntimeContainerState[],
  runtimeState: PreviewRuntimeSelectionState,
): ProjectRunConfigurationStatus {
  const services = configuration.services ?? [];
  if (hostOnlyRunConfiguration(configuration)) return "stopped";
  const matching = containers.filter(({ service }) =>
    services.includes(service),
  );
  const selected =
    runtimeState.desiredStatus === "running" &&
    runtimeState.selectedConfigurationId === configuration.id;
  if (matching.some(runtimeContainerFailed)) return "error";
  if (selected && matching.some(({ status }) => status === "exited")) {
    return "error";
  }
  if (
    services.length > 0 &&
    services.every((service) => serviceRunning(service, matching))
  ) {
    return "running";
  }
  if (selected) return "starting";
  return "stopped";
}

function hostOnlyRunConfiguration(configuration: ProjectRunConfiguration) {
  if (configuration.services?.length) return false;
  return (
    configuration.category === "desktop" ||
    configuration.category === "mobile" ||
    configuration.category === "terminal" ||
    configuration.category === "other"
  );
}

export function previewRunConfigurationServiceIds(
  configuration: ProjectRunConfiguration,
  manifest: PreviewManifest,
) {
  const runtimeServices = new Set(manifest.services.map(({ id }) => id));
  const active = new Set(configuration.services ?? []);
  const pending = Array.from(active);
  while (pending.length) {
    const serviceId = pending.shift();
    const service = manifest.services.find(({ id }) => id === serviceId);
    if (!service) continue;
    for (const dependency of previewServiceDependencies(service)) {
      if (!runtimeServices.has(dependency) || active.has(dependency)) continue;
      active.add(dependency);
      pending.push(dependency);
    }
  }
  return Array.from(active);
}

function previewServiceDependencies(service: PreviewManifestService) {
  return Array.from(
    new Set([
      ...(service.dependsOn ?? []),
      ...(service.bindings ?? []).map(({ source }) => source.service),
    ]),
  );
}

function browserPreviewService(service: PreviewManifestService) {
  return (
    service.kind === "preview" &&
    service.endpoints.some(({ protocol }) => protocol !== "tcp")
  );
}

function normalizeStoredRunConfiguration(
  configuration: ProjectRunConfiguration,
  manifest: PreviewManifest,
) {
  if (
    !configuration.category ||
    configuration.category === "web" ||
    !configuration.previewService
  ) {
    return configuration;
  }
  const service = matchingNonPreviewService(configuration, manifest.services);
  if (!service) return configuration;
  return {
    ...configuration,
    previewService: undefined,
    services: [service.id],
  };
}

function matchingNonPreviewService(
  configuration: ProjectRunConfiguration,
  services: PreviewManifestService[],
) {
  const candidates = services.filter(({ kind }) => kind !== "preview");
  return (
    candidates.find(({ id }) => id === configuration.id) ??
    candidates.find((service) =>
      configurationMatchesService(configuration, service),
    )
  );
}

function configurationMatchesService(
  configuration: ProjectRunConfiguration,
  service: PreviewManifestService,
) {
  const servicePath = service.workingDir?.replace(/^\/workspace\/?/, "");
  return (configuration.scopes ?? []).some(
    (scope) =>
      scope === service.id || Boolean(servicePath && scope === servicePath),
  );
}

function serviceRunning(
  service: string,
  containers: PreviewRuntimeContainerState[],
) {
  return containers.some(
    (container) =>
      container.service === service && container.status === "running",
  );
}

function runtimeContainerFailed(container: PreviewRuntimeContainerState) {
  return (
    container.health === "unhealthy" ||
    container.status === "dead" ||
    container.status === "removing" ||
    (container.status === "exited" && container.exitCode !== 0)
  );
}
