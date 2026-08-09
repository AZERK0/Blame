import { existsSync } from "node:fs";
import { posix } from "node:path";
import { stringify } from "yaml";
import type {
  PreviewExecutionPlan,
  ServiceBindingPlan,
  ServiceEndpointPlan,
  ServiceLaunchPlan,
} from "@blame/preview-runtime";
import { runnerError } from "../protocol/runner-errors.js";

const defaultProxyCertificate =
  "/etc/pki/ca-trust/source/anchors/vercel-proxy-ca.pem";
const relayPortStart = 44_000;
const runtimeHome = "/tmp/blame-home";

export type ComposeRenderResult = {
  yaml: string;
  targets: Record<string, { host: "127.0.0.1"; port: number }>;
};

export function renderCloudCompose(
  plan: PreviewExecutionPlan,
  browserBindingUrls: Record<string, string>,
  options: { projectUser?: string; proxyCertificatePath?: string } = {},
): ComposeRenderResult {
  const proxyCertificate =
    options.proxyCertificatePath ?? defaultProxyCertificate;
  if (!existsSync(proxyCertificate)) {
    throw runnerError(
      "VERCEL_PROXY_CA_MISSING",
      "The Vercel proxy CA is required by the nested Compose engine.",
    );
  }
  const projectUser = options.projectUser ?? "1000:1000";
  const endpointTargets = targetPorts(plan);
  const anchors = loopbackAnchors(plan);
  const services = Object.fromEntries(
    plan.services.map((service) => [
      service.id,
      composeService(
        service,
        plan,
        endpointTargets,
        anchors,
        browserBindingUrls,
        proxyCertificate,
        projectUser,
      ),
    ]),
  );
  const setupServices = Object.fromEntries(
    plan.setup.map((task) => [
      `setup-${task.id}`,
      secureContainer({
        ...containerDefinition(task.container, task.id),
        entrypoint: task.entrypoint,
        command: ["/bin/sh", "-lc", composeLiteral(task.command)],
        working_dir: task.workingDir,
        environment: containerEnvironment(task.environment),
        volumes: workspaceAndCaches(plan, proxyCertificate),
        user: task.runAs === "root" ? "0:0" : projectUser,
        restart: "no",
      }),
    ]),
  );
  const document = {
    name: "blame-preview",
    services: { ...setupServices, ...services },
    volumes: Object.fromEntries(
      plan.caches.map(({ name }) => [`cache-${safeId(name)}`, {}]),
    ),
  };
  return {
    yaml: stringify(document, { lineWidth: 0 }),
    targets: Object.fromEntries(
      [...endpointTargets.entries()].map(([key, port]) => [
        key,
        { host: "127.0.0.1" as const, port },
      ]),
    ),
  };
}

function composeService(
  service: ServiceLaunchPlan,
  plan: PreviewExecutionPlan,
  targets: Map<string, number>,
  anchors: Map<string, string>,
  browserBindingUrls: Record<string, string>,
  proxyCertificate: string,
  projectUser: string,
) {
  const anchor = anchors.get(service.id);
  const isAnchor = !anchor || anchor === service.id;
  const ports = isAnchor
    ? plan.services
        .filter(
          (candidate) =>
            (anchors.get(candidate.id) ?? candidate.id) === service.id,
        )
        .flatMap((candidate) =>
          candidate.endpoints.map(
            (endpoint) =>
              `127.0.0.1:${targets.get(endpointKey(candidate.id, endpoint.id))}:${endpoint.port}`,
          ),
        )
    : undefined;
  const environment = compiledEnvironment(
    service,
    plan,
    anchors,
    browserBindingUrls,
    proxyCertificate,
  );
  return secureContainer({
    ...containerDefinition(service.container, service.id),
    entrypoint: service.entrypoint,
    command: service.command
      ? ["/bin/sh", "-lc", composeLiteral(service.command)]
      : undefined,
    working_dir: service.workingDir,
    environment,
    depends_on: unique([
      ...service.dependsOn,
      ...(anchor && anchor !== service.id ? [anchor] : []),
    ]),
    network_mode:
      anchor && anchor !== service.id ? `service:${anchor}` : undefined,
    ports,
    volumes: workspaceAndCaches(plan, proxyCertificate),
    user: service.user ?? projectUser,
    healthcheck: healthcheck(service.endpoints),
    restart: "unless-stopped",
  });
}

function secureContainer<T extends Record<string, unknown>>(service: T) {
  return withoutUndefined({
    ...service,
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    pids_limit: 512,
    read_only: false,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=256m"],
  });
}

function compiledEnvironment(
  service: ServiceLaunchPlan,
  plan: PreviewExecutionPlan,
  anchors: Map<string, string>,
  browserBindingUrls: Record<string, string>,
  proxyCertificate: string,
) {
  const environment = containerEnvironment(service.environment);
  for (const binding of service.bindings) {
    const source = plan.services.find(
      ({ id }) => id === binding.sourceServiceId,
    );
    const endpoint = source?.endpoints.find(
      ({ id }) => id === binding.sourceEndpointId,
    );
    if (!source || !endpoint)
      throw runnerError("INVALID_PLAN", "Binding source is missing.");
    environment[binding.targetKey] = bindingValue(
      binding,
      service,
      source,
      endpoint,
      anchors,
      browserBindingUrls,
    );
  }
  environment.NODE_EXTRA_CA_CERTS = proxyCertificate;
  return environment;
}

function containerEnvironment(
  environment: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      HOME: runtimeHome,
      XDG_CACHE_HOME: `${runtimeHome}/.cache`,
      ...environment,
    }).map(([key, value]) => [key, composeLiteral(value)]),
  );
}

function composeLiteral(value: string) {
  return value.replace(/(?<!\$)\$(?!\$)/g, () => "$$");
}

function bindingValue(
  binding: ServiceBindingPlan,
  consumer: ServiceLaunchPlan,
  source: ServiceLaunchPlan,
  endpoint: ServiceEndpointPlan,
  anchors: Map<string, string>,
  browserBindingUrls: Record<string, string>,
) {
  if (binding.exposure === "browser") {
    const publicUrl = browserBindingUrls[endpointKey(source.id, endpoint.id)];
    if (!publicUrl)
      throw runnerError(
        "BROWSER_BINDING_UNAVAILABLE",
        "Browser endpoint URL is unavailable.",
      );
    const url = new URL(publicUrl);
    return formattedBinding(
      binding,
      url.hostname,
      url.port || defaultPort(url.protocol),
      publicUrl,
    );
  }
  const sharedLoopback =
    anchors.get(consumer.id) &&
    anchors.get(consumer.id) === anchors.get(source.id);
  const host = sharedLoopback ? "localhost" : source.id;
  const url = `${endpoint.protocol}://${host}:${endpoint.port}${binding.path}`;
  return formattedBinding(binding, host, String(endpoint.port), url);
}

function formattedBinding(
  binding: ServiceBindingPlan,
  host: string,
  port: string,
  url: string,
) {
  if (binding.format === "host") return host;
  if (binding.format === "port") return port;
  if (binding.format === "host-port") return `${host}:${port}`;
  return url;
}

function healthcheck(endpoints: ServiceEndpointPlan[]) {
  const endpoint = endpoints.find(
    ({ healthcheck }) => healthcheck,
  )?.healthcheck;
  const owner = endpoints.find(({ healthcheck }) => healthcheck);
  if (!endpoint || !owner) return undefined;
  const test =
    endpoint.type === "tcp"
      ? ["CMD-SHELL", `exec 3<>/dev/tcp/127.0.0.1/${owner.port}`]
      : [
          "CMD",
          "wget",
          "-q",
          "-O",
          "/dev/null",
          `http://127.0.0.1:${owner.port}${safeHealthPath(endpoint.path)}`,
        ];
  return {
    test,
    interval: "2s",
    timeout: `${Math.ceil(endpoint.timeoutMs / 1000)}s`,
    retries: 15,
  };
}

function safeHealthPath(value: string | undefined) {
  const path = value ?? "/";
  if (!path.startsWith("/") || /[\0\r\n]/.test(path)) {
    throw runnerError(
      "INVALID_HEALTHCHECK",
      "HTTP healthcheck path is invalid.",
    );
  }
  return path;
}

function workspaceAndCaches(
  plan: PreviewExecutionPlan,
  proxyCertificate: string,
) {
  return [
    "/workspace:/workspace:rw",
    "/workspace/.git:/workspace/.git:ro",
    `${proxyCertificate}:${proxyCertificate}:ro`,
    ...plan.caches.map(({ name, target }) => `cache-${safeId(name)}:${target}`),
  ];
}

function targetPorts(plan: PreviewExecutionPlan) {
  const targets = new Map<string, number>();
  let port = relayPortStart;
  for (const service of plan.services) {
    for (const endpoint of service.endpoints)
      targets.set(endpointKey(service.id, endpoint.id), port++);
  }
  return targets;
}

function loopbackAnchors(plan: PreviewExecutionPlan) {
  const anchors = new Map<string, string>();
  for (const group of plan.networking.loopbackGroups) {
    const anchor = group.serviceIds[0];
    if (!anchor) continue;
    for (const serviceId of group.serviceIds) {
      const existing = anchors.get(serviceId);
      if (existing && existing !== anchor) {
        throw runnerError(
          "AMBIGUOUS_LOOPBACK_GROUP",
          "Overlapping loopback groups are unsupported.",
        );
      }
      anchors.set(serviceId, anchor);
    }
  }
  return anchors;
}

function containerDefinition(
  container: ServiceLaunchPlan["container"],
  id: string,
) {
  if (container.image) return { image: container.image };
  if (!container.build) {
    throw runnerError(
      "CONTAINER_SOURCE_REQUIRED",
      `Compose service ${id} requires an image or build.`,
    );
  }
  const context = posix.join("/workspace", container.build.context);
  const dockerfile = container.build.dockerfile;
  if (
    (!context.startsWith("/workspace/") && context !== "/workspace") ||
    dockerfile.startsWith("/") ||
    dockerfile.split("/").includes("..")
  ) {
    throw runnerError(
      "INVALID_BUILD_CONTEXT",
      `Compose build ${id} escapes the workspace.`,
    );
  }
  return {
    build: withoutUndefined({
      context,
      dockerfile,
      target: container.build.target,
    }),
  };
}

function endpointKey(serviceId: string, endpointId: string) {
  return `${serviceId}:${endpointId}`;
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function composeCacheVolumeName(value: string) {
  return `blame-preview_cache-${safeId(value)}`;
}

function defaultPort(protocol: string) {
  return protocol === "https:" ? "443" : "80";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function withoutUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
