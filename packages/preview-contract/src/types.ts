export type PreviewManifestVersion = 1 | 2 | 3;

export type PreviewManifestExecutionSource =
  | { kind: "container"; image: string }
  | { kind: "process"; toolchain?: string }
  | { kind: "auto"; image?: string; toolchain?: string };

export type PreviewManifestConfidence = "low" | "medium" | "high";

export type PreviewManifestEnvironment = Record<string, string>;

export type PreviewManifestProject = {
  root?: string;
  detectedStack?: string[];
  confidence?: PreviewManifestConfidence;
};

export type PreviewManifestSetupTask = {
  id: string;
  image: string;
  source?: PreviewManifestExecutionSource;
  workingDir?: string;
  command: string;
  runAs?: "host" | "root";
  environment?: PreviewManifestEnvironment;
  dependsOn?: string[];
};

export type PreviewManifestServiceKind = "preview" | "dependency" | "worker";

export type PreviewManifestPreview = {
  internalPort: number;
  protocol: "http";
  path: string;
};

export type PreviewManifestHealthcheck = {
  type: "http";
  path: string;
  timeoutMs: number;
};

export type PreviewManifestEndpointHealthcheck = {
  type: "http" | "tcp";
  path?: string;
  timeoutMs: number;
};

export type PreviewManifestEndpoint = {
  id: string;
  protocol: "http" | "https" | "tcp";
  port: number;
  healthcheck?: PreviewManifestEndpointHealthcheck;
};

export type PreviewManifestBindingTarget = {
  type: "environment";
  key: string;
};

export type PreviewManifestBindingSource = {
  service: string;
  endpoint: string;
};

export type PreviewManifestBinding = {
  target: PreviewManifestBindingTarget;
  source: PreviewManifestBindingSource;
  exposure: "server" | "browser";
  format?: "url" | "host" | "port" | "host-port";
  path?: string;
};

export type PreviewManifestService = {
  id: string;
  kind: PreviewManifestServiceKind;
  image: string;
  source?: PreviewManifestExecutionSource;
  workingDir?: string;
  command?: string;
  environment?: PreviewManifestEnvironment;
  dependsOn?: string[];
  preview?: PreviewManifestPreview;
  healthcheck?: PreviewManifestHealthcheck;
  endpoints?: PreviewManifestEndpoint[];
  bindings?: PreviewManifestBinding[];
};

export type PreviewManifestProbeTarget = {
  service: string;
  endpoint: string;
  path?: string;
};

export type PreviewManifestProbe = {
  id: string;
  from: "host" | string;
  target: PreviewManifestProbeTarget;
  type: "http" | "tcp";
  acceptedStatuses?: number[];
  timeoutMs?: number;
  required?: boolean;
};

export type PreviewManifestCache = {
  name: string;
  target: string;
};

export type PreviewManifestRisk = {
  level: "low" | "medium" | "high";
  message: string;
};

export type PreviewManifest = {
  version: PreviewManifestVersion;
  confidence: PreviewManifestConfidence;
  project: PreviewManifestProject;
  setup: PreviewManifestSetupTask[];
  services: PreviewManifestService[];
  caches: PreviewManifestCache[];
  risks: PreviewManifestRisk[];
  probes?: PreviewManifestProbe[];
};
