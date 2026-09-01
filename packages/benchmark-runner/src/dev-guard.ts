export class HeadlessConfigurationError extends Error {}

export function assertHeadlessDevelopment(environment: NodeJS.ProcessEnv) {
  if (environment.BLAME_HEADLESS_DEV !== "true") {
    throw new HeadlessConfigurationError(
      "Set BLAME_HEADLESS_DEV=true to enable the benchmark runner.",
    );
  }
  if (environment.NODE_ENV === "production") {
    throw new HeadlessConfigurationError(
      "The benchmark runner is unavailable with NODE_ENV=production.",
    );
  }
  if (environment.BLAME_AGENT_PACKAGED === "true") {
    throw new HeadlessConfigurationError(
      "The benchmark runner is unavailable in packaged applications.",
    );
  }
}
