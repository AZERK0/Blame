import net from "node:net";
import type { PreviewExecutionPlan } from "@blame/preview-runtime";

const readinessStabilityMs = 500;
const readinessPollIntervalMs = 250;

export async function probeServices(
  plan: PreviewExecutionPlan,
  targets: Record<string, { host: string; port: number }>,
) {
  return Promise.all(
    plan.services.map(async (service) => {
      const endpoints = service.endpoints.filter(
        ({ healthcheck }) => healthcheck,
      );
      if (!endpoints.length)
        return { id: service.id, running: true, healthy: undefined };
      const results = await Promise.all(
        endpoints.map(async (endpoint) => {
          const target = targets[`${service.id}:${endpoint.id}`];
          if (!target || !endpoint.healthcheck) return false;
          return waitForHealthyEndpoint(
            target.host,
            target.port,
            endpoint.healthcheck,
          );
        }),
      );
      return { id: service.id, running: true, healthy: results.every(Boolean) };
    }),
  );
}

async function waitForHealthyEndpoint(
  host: string,
  port: number,
  healthcheck: { type: "http" | "tcp"; path?: string; timeoutMs: number },
) {
  const deadline = Date.now() + healthcheck.timeoutMs;
  let healthySince: number | undefined;
  do {
    const remaining = Math.max(1, deadline - Date.now());
    const healthy =
      healthcheck.type === "tcp"
        ? await tcpProbe(host, port, Math.min(1_000, remaining))
        : await httpProbe(
            host,
            port,
            healthcheck.path ?? "/",
            Math.min(2_000, remaining),
          );
    const now = Date.now();
    if (healthy) {
      healthySince ??= now;
      if (now - healthySince >= readinessStabilityMs) return true;
    } else {
      healthySince = undefined;
    }
    if (now < deadline)
      await delay(Math.min(readinessPollIntervalMs, deadline - now));
  } while (Date.now() < deadline);
  return false;
}

function tcpProbe(host: string, port: number, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(port, host);
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function httpProbe(
  host: string,
  port: number,
  path: string,
  timeoutMs: number,
) {
  try {
    const response = await fetch(`http://${host}:${port}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    return response.status >= 100 && response.status < 500;
  } catch {
    return false;
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
