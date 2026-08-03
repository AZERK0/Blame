import env from '#start/env'
import {
  workspaceArtifactsReady,
  workspaceArtifactTransferHosts,
} from '#config/workspace_artifacts'

export type PreviewRuntimeConfig = ReturnType<typeof previewRuntimeConfig>

export function previewRuntimeConfig() {
  return {
    enabled: env.get('BLAME_CLOUD_RUNTIME_ENABLED') ?? false,
    maxActivePerUser: positiveInteger(env.get('BLAME_PREVIEW_MAX_ACTIVE_PER_USER'), 2),
    maxConcurrentVcpusPerUser: positiveInteger(
      env.get('BLAME_PREVIEW_MAX_CONCURRENT_VCPUS_PER_USER'),
      8
    ),
    maxCreationsPerMinute: positiveInteger(env.get('BLAME_PREVIEW_MAX_CREATIONS_PER_MINUTE'), 3),
    maxCreationsPerDay: positiveInteger(env.get('BLAME_PREVIEW_MAX_CREATIONS_PER_DAY'), 20),
    maxCreationsPerMonth: positiveInteger(env.get('BLAME_PREVIEW_MAX_CREATIONS_PER_MONTH'), 100),
    monthlyBudgetUsd: positiveNumber(env.get('BLAME_PREVIEW_MONTHLY_BUDGET_USD'), 20),
    globalMonthlyBudgetUsd: positiveNumber(
      env.get('BLAME_PREVIEW_GLOBAL_MONTHLY_BUDGET_USD'),
      1_000
    ),
    disabledTenantIds: new Set(csv(env.get('BLAME_PREVIEW_DISABLED_TENANT_IDS'))),
    idleTimeoutMinutes: positiveInteger(env.get('BLAME_PREVIEW_IDLE_TIMEOUT_MINUTES'), 15),
    leaseSeconds: positiveInteger(env.get('BLAME_PREVIEW_LEASE_SECONDS'), 90),
    rpoSeconds: Math.min(10, positiveInteger(env.get('BLAME_PREVIEW_RPO_SECONDS'), 10)),
    edgeOrigin: secureOrigin(env.get('BLAME_PREVIEW_EDGE_ORIGIN') ?? 'https://preview.blame.dev'),
    ticketTtlSeconds: positiveInteger(env.get('BLAME_PREVIEW_TICKET_TTL_SECONDS'), 60),
    capabilityPublicKey: normalizePem(env.get('BLAME_PREVIEW_CAPABILITY_PUBLIC_KEY')),
    capabilityPrivateKey: normalizePem(env.get('BLAME_PREVIEW_CAPABILITY_PRIVATE_KEY')?.release()),
    workspaceEncryptionReady: workspaceArtifactsReady(),
    artifactTransferHosts: [...workspaceArtifactTransferHosts(), ...urlHosts([env.get('APP_URL')])],
    sandbox: {
      image: env.get('BLAME_SANDBOX_RUNNER_IMAGE'),
      bootstrapUrl: env.get('BLAME_SANDBOX_BOOTSTRAP_URL'),
      bootstrapSha256: env.get('BLAME_SANDBOX_BOOTSTRAP_SHA256'),
      runnerVersion: env.get('BLAME_SANDBOX_RUNNER_VERSION') ?? '0.1.0',
      protocolVersion: positiveInteger(env.get('BLAME_SANDBOX_PROTOCOL_VERSION'), 1),
      vercelPlan: env.get('BLAME_SANDBOX_VERCEL_PLAN') ?? 'hobby',
      timeoutMinutes: positiveInteger(env.get('BLAME_SANDBOX_TIMEOUT_MINUTES'), 60),
      snapshotRetentionDays: positiveInteger(env.get('BLAME_SANDBOX_SNAPSHOT_RETENTION_DAYS'), 7),
      deploymentId: env.get('BLAME_SANDBOX_DEPLOYMENT_ID'),
      egressAllowlist: csv(env.get('BLAME_SANDBOX_EGRESS_ALLOWLIST')).length
        ? csv(env.get('BLAME_SANDBOX_EGRESS_ALLOWLIST'))
        : [
            'registry.npmjs.org',
            '*.npmjs.org',
            'github.com',
            '*.githubusercontent.com',
            'auth.docker.io',
            'registry-1.docker.io',
            'production.cloudfront.docker.com',
          ],
      accessToken: env.get('VERCEL_ACCESS_TOKEN')?.release(),
      projectId: env.get('VERCEL_PROJECT_ID'),
      teamId: env.get('VERCEL_TEAM_ID'),
    },
  }
}

function positiveInteger(value: number | undefined, fallback: number) {
  return value && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function positiveNumber(value: number | undefined, fallback: number) {
  return value && Number.isFinite(value) && value > 0 ? value : fallback
}

function csv(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function urlHosts(values: Array<string | undefined>) {
  return values.flatMap((value) => {
    try {
      return value ? [new URL(value).hostname] : []
    } catch {
      return []
    }
  })
}

function secureOrigin(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Managed preview edge origin must use HTTPS.')
  }
  return url.origin
}

function normalizePem(value: string | undefined) {
  return value?.replaceAll('\\n', '\n')
}
