import type {
  PreviewExecutionPlan,
  RuntimeSelection,
} from "@blame/preview-runtime";
import { runnerError } from "../protocol/runner-server.js";

export function normalizeRuntimeSelection(
  plan: PreviewExecutionPlan,
  requested: RuntimeSelection,
): RuntimeSelection {
  if (!requested.configurationId?.trim()) {
    throw runnerError("INVALID_SELECTION", "A preview configuration ID is required.");
  }
  if (!requested.serviceIds?.length) {
    return { configurationId: requested.configurationId };
  }
  const services = new Map(plan.services.map((service) => [service.id, service]));
  const selected = new Set(requested.serviceIds);
  const unknown = [...selected].filter((id) => !services.has(id));
  if (unknown.length) {
    throw runnerError("INVALID_SELECTION", `Unknown selected services: ${unknown.join(", ")}.`);
  }
  for (const id of selected) {
    for (const dependency of services.get(id)!.dependsOn) selected.add(dependency);
  }
  return { configurationId: requested.configurationId, serviceIds: [...selected] };
}
