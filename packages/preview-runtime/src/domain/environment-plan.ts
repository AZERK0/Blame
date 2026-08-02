export type EnvironmentPlanEntry = {
  key: string;
  scope: "setup" | "service" | "ssr" | "client-public";
  classification: "non-secret" | "public-build-time" | "secret";
  delivery:
    | "literal"
    | "brokered-header"
    | "ephemeral-environment"
    | "ephemeral-file";
  source: "runtime-binding" | "story" | "project" | "account" | "manifest";
  serviceId?: string;
  consentId?: string;
  snapshot: "never";
};

export type SecretPlan = {
  entries: EnvironmentPlanEntry[];
  cleanupRequired: true;
};

export function environmentPlanPrecedence(entry: EnvironmentPlanEntry) {
  return {
    "runtime-binding": 5,
    story: 4,
    project: 3,
    account: 2,
    manifest: 1,
  }[entry.source];
}

export function mergeEnvironmentPlan(entries: EnvironmentPlanEntry[]) {
  const selected = new Map<string, EnvironmentPlanEntry>();
  for (const entry of entries) {
    const key = `${entry.serviceId ?? "*"}:${entry.scope}:${entry.key}`;
    const current = selected.get(key);
    if (!current || environmentPlanPrecedence(entry) > environmentPlanPrecedence(current)) {
      selected.set(key, entry);
    }
  }
  return { cleanupRequired: true, entries: [...selected.values()] } satisfies SecretPlan;
}
