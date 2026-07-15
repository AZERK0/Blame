import type {
  PreviewManifest,
  PreviewManifestService,
  ProjectRunConfiguration,
  ProjectRunConfigurationStatus,
} from "@blame/agent-runtime";

export type PreviewRuntimeSelectionState = {
  desiredStatus: "running" | "stopped";
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
  requestedId: string | undefined,
): PreviewRuntimeSelectionState {
  const requested = configurations.find(({ id }) => id === requestedId);
  const selected =
    requested ??
    configurations.find(({ default: isDefault }) => isDefault) ??
    configurations[0];
  return {
    desiredStatus: "running",
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

export function previewRunConfigurationStatus(
  configuration: ProjectRunConfiguration,
  containers: PreviewRuntimeContainerState[],
  runtimeState: PreviewRuntimeSelectionState,
): ProjectRunConfigurationStatus {
  const services = configuration.services ?? [];
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
      ...(service.bindings ?? [])
        .filter(({ exposure }) => exposure === "server")
        .map(({ source }) => source.service),
    ]),
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
