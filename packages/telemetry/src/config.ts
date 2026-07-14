import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "./semantic-attributes.js";

export type BlameTelemetryConfig = {
  authorization?: TelemetryExportAuthorization;
  deploymentEnvironment: string;
  enabled: boolean;
  endpoint?: string;
  exportIntervalMs: number;
  resourceAttributes: Record<string, string>;
  serviceName: string;
  serviceVersion: string;
};

export type BlameTelemetryOptions = {
  authorization?: TelemetryExportAuthorization;
  endpoint?: string;
  environment?: NodeJS.ProcessEnv;
  serviceName: string;
  serviceVersion: string;
};

export type TelemetryExportAuthorization = {
  headers(): Promise<Record<string, string>>;
  isReady(): boolean;
};

export type TelemetrySignal = "logs" | "metrics" | "traces";

const defaultExportIntervalMs = 60_000;
const allowedResourceAttributes = new Set([
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  "cloud.region",
  "host.arch",
  "service.instance.id",
  "service.namespace",
]);

export function loadTelemetryConfig(
  options: BlameTelemetryOptions,
): BlameTelemetryConfig {
  const environment = options.environment ?? process.env;
  const endpoint = validEndpoint(
    options.endpoint ?? environment.OTEL_EXPORTER_OTLP_ENDPOINT,
  );
  const disabled =
    environment.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true";
  const deploymentEnvironment = deploymentName(environment);
  return {
    authorization: options.authorization,
    deploymentEnvironment,
    enabled: Boolean(endpoint) && !disabled,
    endpoint,
    exportIntervalMs: positiveInteger(
      environment.OTEL_METRIC_EXPORT_INTERVAL,
      defaultExportIntervalMs,
    ),
    resourceAttributes: resourceAttributes(environment),
    serviceName: options.serviceName,
    serviceVersion: options.serviceVersion,
  };
}

export function otlpSignalEndpoint(endpoint: string, signal: TelemetrySignal) {
  const url = new URL(endpoint);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/${signal}`;
  return url.toString();
}

function deploymentName(environment: NodeJS.ProcessEnv) {
  const configured =
    resourceAttributes(environment)[ATTR_DEPLOYMENT_ENVIRONMENT_NAME];
  return configured ?? environment.NODE_ENV?.trim() ?? "development";
}

function resourceAttributes(environment: NodeJS.ProcessEnv) {
  const entries = parseResourceAttributes(environment.OTEL_RESOURCE_ATTRIBUTES);
  return Object.fromEntries(
    entries.filter(([key]) => allowedResourceAttributes.has(key)),
  );
}

function parseResourceAttributes(value: string | undefined) {
  if (!value) return [];
  return value.split(",").flatMap(parseResourceAttribute);
}

function parseResourceAttribute(value: string): Array<[string, string]> {
  const separator = value.indexOf("=");
  if (separator < 1) return [];
  const key = value.slice(0, separator).trim();
  const attributeValue = decodeResourceValue(value.slice(separator + 1).trim());
  return key && attributeValue ? [[key, attributeValue]] : [];
}

function decodeResourceValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function validEndpoint(value: string | undefined) {
  const endpoint = value?.trim();
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash)
      return undefined;
    return url.protocol === "http:" || url.protocol === "https:"
      ? endpoint
      : undefined;
  } catch {
    return undefined;
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
