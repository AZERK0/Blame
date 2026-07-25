import { initializeDesktopTelemetry } from "./desktop-telemetry.ts";

const serviceVersion = process.env.BLAME_AGENT_SERVICE_VERSION ?? "0.0.0";
const packaged = process.env.BLAME_AGENT_PACKAGED === "true";

initializeDesktopTelemetry(serviceVersion, packaged, "blame-agent-worker");

await import("./agent-runtime-process-entry.ts");
