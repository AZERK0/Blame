import env from '#start/env'

export type PreviewRuntimeConfig = ReturnType<typeof previewRuntimeConfig>

export function previewRuntimeConfig() {
  const attachmentEndpoint = env.get('ATTACHMENTS_S3_ENDPOINT')
  const attachmentBucket = env.get('ATTACHMENTS_S3_BUCKET')
  const attachmentForcePathStyle = env.get('ATTACHMENTS_S3_FORCE_PATH_STYLE') ?? false
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
    workspaceEncryptionReady:
      env.get('ATTACHMENTS_STORAGE_DRIVER') === 'memory' ||
      (Boolean(env.get('ATTACHMENTS_S3_KMS_KEY_ID')?.trim()) && secureUrl(attachmentEndpoint)),
    artifactTransferHosts: [
      ...objectStorageHosts(attachmentEndpoint, attachmentBucket, attachmentForcePathStyle),
      ...urlHosts([env.get('APP_URL')]),
    ],
    sandbox: {
      image: env.get('BLAME_SANDBOX_RUNNER_IMAGE'),
      bootstrapUrl: env.get('BLAME_SANDBOX_BOOTSTRAP_URL'),
      bootstrapSha256: env.get('BLAME_SANDBOX_BOOTSTRAP_SHA256'),
      runnerVersion: env.get('BLAME_SANDBOX_RUNNER_VERSION') ?? '0.1.0',
      protocolVersion: positiveInteger(env.get('BLAME_SANDBOX_PROTOCOL_VERSION'), 1),
      timeoutMinutes: positiveInteger(env.get('BLAME_SANDBOX_TIMEOUT_MINUTES'), 60),
      snapshotRetentionDays: positiveInteger(env.get('BLAME_SANDBOX_SNAPSHOT_RETENTION_DAYS'), 7),
      deploymentId: env.get('BLAME_SANDBOX_DEPLOYMENT_ID'),
      egressAllowlist: csv(env.get('BLAME_SANDBOX_EGRESS_ALLOWLIST')).length
        ? csv(env.get('BLAME_SANDBOX_EGRESS_ALLOWLIST'))
        : ['registry.npmjs.org', '*.npmjs.org', 'github.com', '*.githubusercontent.com'],
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

function objectStorageHosts(
  endpoint: string | undefined,
  bucket: string | undefined,
  forcePathStyle: boolean
) {
  try {
    if (!endpoint) return []
    const host = new URL(endpoint).hostname
    const virtualHost =
      !forcePathStyle && bucket && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
        ? `${bucket}.${host}`
        : undefined
    return [...new Set([host, virtualHost].filter((value): value is string => Boolean(value)))]
  } catch {
    return []
  }
}

function secureUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
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
