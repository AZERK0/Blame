import { previewRuntimeConfig, type PreviewRuntimeConfig } from '#config/preview_runtime'
import PreviewEdgeRouteService from '#services/preview_gateway/preview_edge_route_service'
import { vercelNetworkPolicy } from '#services/sandboxes/vercel_network_policy'
import WorkspaceArtifactService from '#services/workspace_artifacts/workspace_artifact_service'
import { Sandbox, type NetworkPolicy } from '@vercel/sandbox'
import { randomUUID } from 'node:crypto'
import {
  PreviewRuntimeError,
  resolveCapabilities,
  runtimeHandle,
  type DurableDeltaReceipt,
  type EndpointMap,
  type ExecInput,
  type ExecResult,
  type LogRequest,
  type PreviewExecutionPlan,
  type PreviewLogEvent,
  type PreviewRuntimeDriver,
  type ProvisionInput,
  type RuntimeHandle,
  type RuntimeObservation,
  type RuntimeSelection,
  type RuntimeUsage,
  type SourceArtifact,
} from '@blame/preview-runtime'
import {
  capabilityKeysMatch,
  delay,
  desiredPorts,
  inactiveObservation,
  providerFailure,
  providerResourceMissing,
  retryableProviderError,
  runnerFailure,
  sandboxNameFor,
  shortTag,
  trustedBootstrapUrl,
  vercelHandle,
  type VercelRuntimeHandle,
} from '#services/sandboxes/vercel_sandbox_support'
type RunnerResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string } }

const runnerBinary = '/opt/blame/bin/blame-sandbox-runner'
const runnerControlBinary = '/opt/blame/bin/blame-runnerctl'
const runnerRequestDirectory = '/run/blame/control/requests'

export default class VercelSandboxDriver implements PreviewRuntimeDriver {
  readonly profile: 'vercel-compose' | 'vercel-process'

  constructor(
    profile: 'vercel-compose' | 'vercel-process' = 'vercel-compose',
    private readonly config: PreviewRuntimeConfig = previewRuntimeConfig(),
    private readonly routes: PreviewEdgeRouteService = new PreviewEdgeRouteService(config),
    private readonly artifacts: WorkspaceArtifactService = new WorkspaceArtifactService()
  ) {
    this.profile = profile
  }

  limits() {
    return {
      observedAt: new Date().toISOString(),
      maxDurationHours: 24,
      maxPublishedPorts: 15,
      maxVcpus: 8,
      memoryGbPerVcpu: 2,
      region: 'iad1',
      source: '@vercel/sandbox@2.9.2',
    }
  }

  async capabilities(plan: PreviewExecutionPlan) {
    const report = resolveCapabilities(this.profile, plan)
    const configurationFailure = this.configurationFailure()
    if (configurationFailure) {
      report.compatible = false
      report.incompatibilities.push({
        code: 'CAPABILITY_REQUIRED',
        message: configurationFailure,
      })
    }
    return report
  }

  async provisionHost(input: ProvisionInput) {
    this.assertResourceSize(input.resourceSize)
    const gatewayPorts = desiredPorts(input.plan)
    const sandboxName = sandboxNameFor(input.sessionId)
    const sandbox = await this.providerCall('create', () =>
      Sandbox.getOrCreate({
        ...this.credentials(),
        name: sandboxName,
        ...this.imageOrRuntime(),
        persistent: true,
        ports: gatewayPorts,
        resources: { vcpus: input.resourceSize.vcpus },
        timeout: this.config.sandbox.timeoutMinutes * 60_000,
        snapshotExpiration: this.config.sandbox.snapshotRetentionDays * 86_400_000,
        keepLastSnapshots: { count: 1, deleteEvicted: true },
        networkPolicy: this.networkPolicy(),
        tags: {
          application: 'blame',
          deployment: shortTag(this.config.sandbox.deploymentId!),
          session: shortTag(input.sessionId),
        },
      })
    )
    try {
      await sandbox.update({
        persistent: true,
        ports: gatewayPorts,
        resources: { vcpus: input.resourceSize.vcpus },
        timeout: this.config.sandbox.timeoutMinutes * 60_000,
        snapshotExpiration: this.config.sandbox.snapshotRetentionDays * 86_400_000,
        keepLastSnapshots: { count: 1, deleteEvicted: true },
        networkPolicy: this.networkPolicy(),
      })
      await this.bootstrap(sandbox)
      const handle: VercelRuntimeHandle = {
        kind: 'vercel-sandbox',
        sandboxName,
        sessionId: input.sessionId,
        generation: input.generation,
        fencingToken: input.fencingToken,
        gatewayPorts,
      }
      const runtime = runtimeHandle(handle)
      await this.assertHandshake(sandbox, runtime)
      return runtime
    } catch (error) {
      await sandbox.delete().catch(() => undefined)
      throw error
    }
  }

  async resumeHost(handle: RuntimeHandle) {
    const payload = vercelHandle(handle)
    payload.generation += 1
    const sandbox = await this.sandbox(payload, true)
    await sandbox.update({ ports: payload.gatewayPorts, networkPolicy: this.networkPolicy() })
    await this.bootstrap(sandbox)
    await this.assertHandshake(sandbox, handle)
    await this.runnerCall(handle, {
      operation: 'resume-host',
      sessionId: payload.sessionId,
      generation: payload.generation,
    })
  }

  async syncIn(handle: RuntimeHandle, source: SourceArtifact) {
    return this.runnerCall<{ sourceRevision: string; workspaceHash: string }>(handle, {
      operation: 'source-import',
      source,
    })
  }

  async prepareEngine(handle: RuntimeHandle, plan: PreviewExecutionPlan) {
    const payload = vercelHandle(handle)
    const browserBindingUrls = await this.publishPlannedRoutes(payload, plan)
    await this.runnerCall(handle, {
      operation: 'prepare-engine',
      engine: this.profile,
      plan,
      browserBindingUrls,
      capabilityPublicKey: this.config.capabilityPublicKey,
      sessionId: payload.sessionId,
      generation: payload.generation,
    })
  }

  async startServices(handle: RuntimeHandle, selection: RuntimeSelection) {
    await this.runnerCall(handle, { operation: 'start-services', selection })
  }

  async stopServices(handle: RuntimeHandle) {
    await this.runnerCall(handle, { operation: 'stop-services' })
    await this.routes.revokeSession(vercelHandle(handle).sessionId)
  }

  async exec(handle: RuntimeHandle, input: ExecInput) {
    const cwd = input.cwd ?? '/workspace'
    if (cwd !== '/workspace' && !cwd.startsWith('/workspace/')) {
      throw new PreviewRuntimeError({
        code: 'PREVIEW_ACCESS_DENIED',
        message: 'Remote commands are restricted to the story workspace.',
        retryable: false,
      })
    }
    return this.runnerCall<ExecResult>(handle, {
      operation: 'exec',
      command: input.command,
      args: input.args ?? [],
      cwd,
      environment: input.environment,
      timeoutMs: input.timeoutMs,
    })
  }

  async inspect(
    handle: RuntimeHandle,
    options: { probeServices?: boolean } = {}
  ): Promise<RuntimeObservation> {
    const payload = vercelHandle(handle)
    const sandbox = await this.findSandbox(payload, false)
    if (!sandbox) return inactiveObservation(payload.generation, 'missing', 'idle')
    if (['stopped', 'aborted', 'snapshotting'].includes(sandbox.status)) {
      return inactiveObservation(payload.generation, 'suspended', 'stopped')
    }
    if (sandbox.status === 'failed')
      return inactiveObservation(payload.generation, 'failed', 'failed')
    if (sandbox.status !== 'running')
      return inactiveObservation(payload.generation, 'running', 'idle')
    const observation = await this.runnerCall<RuntimeObservation>(handle, {
      operation: 'inspect',
      probeServices: options.probeServices,
    })
    observation.generation ??= payload.generation
    if (observation.handshake) {
      observation.handshake.imageDigest =
        sandbox.image?.split('@').at(-1) ?? observation.handshake.imageDigest
    }
    return observation
  }

  async endpoints(handle: RuntimeHandle): Promise<EndpointMap> {
    const payload = vercelHandle(handle)
    const sandbox = await this.sandbox(payload, true)
    const internal = await this.runnerCall<{
      revision: number
      primaryEndpointId: string
      routes: Array<{
        serviceId: string
        endpointId: string
        protocol: 'http' | 'https' | 'ws' | 'wss'
        logicalPort: number
        targetHost: string
        targetPort: number
        sandboxPort: number
        basePathMode: 'root' | 'explicit-prefix'
        externallyCompatible: boolean
      }>
      supportsWebSocket: boolean
      integratedPreviewRequired: boolean
      incompatibilityReasons: string[]
    }>(handle, { operation: 'endpoints' })
    const routes = await Promise.all(
      internal.routes.map(async (route) => {
        if (!payload.gatewayPorts.includes(route.sandboxPort)) {
          throw runnerFailure(
            'UNDECLARED_GATEWAY_PORT',
            'Runner returned an undeclared gateway port.'
          )
        }
        const providerUrl = sandbox.domain(route.sandboxPort)
        const published = await this.routes.publish({
          sessionId: payload.sessionId,
          endpointId: route.endpointId,
          serviceId: route.serviceId,
          logicalPort: route.logicalPort,
          generation: payload.generation,
          upstreamUrl: providerUrl,
        })
        return { ...route, logicalHost: 'localhost' as const, publicUrl: published.publicUrl }
      })
    )
    const primary = routes.find(({ endpointId }) => endpointId === internal.primaryEndpointId)
    return {
      revision: internal.revision,
      primaryEndpointId: internal.primaryEndpointId,
      primaryPublicUrl: primary?.publicUrl ?? '',
      routes,
      supportsWebSocket: internal.supportsWebSocket,
      integratedPreviewRequired: internal.integratedPreviewRequired,
      incompatibilityReasons: internal.incompatibilityReasons,
    }
  }

  async *logs(input: LogRequest): AsyncIterable<PreviewLogEvent> {
    const events = await this.runnerCall<PreviewLogEvent[]>(input.handle, {
      operation: 'logs',
      cursor: input.cursor,
      serviceId: input.serviceId,
    })
    for (const event of events) yield event
  }

  async exportDelta(handle: RuntimeHandle, revision: string): Promise<DurableDeltaReceipt> {
    const payload = vercelHandle(handle)
    const artifact = await this.artifacts.prepareDeltaUpload(payload.sessionId, payload.generation)
    const prepared = await this.runnerCall<{
      sha256: string
      size: number
      baseHash: string
      finalHash: string
      generation: number
      revision: string
    }>(handle, { operation: 'source-export-prepare', revision, artifactId: artifact.artifactId })
    if (prepared.generation !== payload.generation) {
      throw runnerFailure('DELTA_GENERATION_MISMATCH', 'Runner delta generation is stale.')
    }
    const upload = await this.artifacts.deltaUploadTarget(
      artifact.artifactId,
      prepared.sha256,
      prepared.size
    )
    await this.runnerCall(handle, {
      operation: 'source-export-upload',
      artifactId: artifact.artifactId,
      upload,
    })
    const receipt = {
      artifactId: artifact.artifactId,
      baseHash: prepared.baseHash,
      finalHash: prepared.finalHash,
      generation: payload.generation,
      revision: prepared.revision,
      durableAt: new Date().toISOString(),
      sha256: prepared.sha256,
      size: prepared.size,
    }
    await this.artifacts.confirmDelta(receipt)
    return receipt
  }

  async acknowledgeDelta(handle: RuntimeHandle, revision: string) {
    await this.runnerCall(handle, { operation: 'source-export-ack', revision })
  }

  async suspendHost(handle: RuntimeHandle) {
    const payload = vercelHandle(handle)
    const sandbox = await this.findSandbox(payload, false)
    await this.routes.revokeSession(payload.sessionId)
    if (!sandbox || ['stopped', 'aborted'].includes(sandbox.status)) {
      return { snapshotId: sandbox?.currentSnapshotId, suspendedAt: new Date().toISOString() }
    }
    const snapshot = await this.providerCall('snapshot', () =>
      sandbox.snapshot({ expiration: this.config.sandbox.snapshotRetentionDays * 86_400_000 })
    )
    return { snapshotId: snapshot.snapshotId, suspendedAt: new Date().toISOString() }
  }

  async destroyHost(handle: RuntimeHandle) {
    const payload = vercelHandle(handle)
    await this.routes.revokeSession(payload.sessionId)
    const sandbox = await this.findSandbox(payload, false)
    if (!sandbox) return { destroyedAt: new Date().toISOString(), pendingCleanupIds: [] }
    await this.providerCall('delete', () => sandbox.delete())
    return { destroyedAt: new Date().toISOString(), pendingCleanupIds: [] }
  }

  async usage(handle: RuntimeHandle): Promise<RuntimeUsage> {
    const sandbox = await this.sandbox(vercelHandle(handle), false)
    const activeCpuSeconds = (sandbox.totalActiveCpuDurationMs ?? 0) / 1000
    const durationSeconds = Math.max(60, (sandbox.totalDurationMs ?? 0) / 1000)
    const memoryGb = sandbox.memory ? sandbox.memory / 1024 : (sandbox.vcpus ?? 2) * 2
    const memoryGbSeconds = durationSeconds * memoryGb
    return {
      activeCpuSeconds,
      memoryGbSeconds,
      ingressBytes: sandbox.totalIngressBytes ?? 0,
      egressBytes: sandbox.totalEgressBytes ?? 0,
      snapshotBytes: 0,
      estimatedCostUsd:
        (activeCpuSeconds / 3600) * 0.128 +
        (memoryGbSeconds / 3600) * 0.0212 +
        (((sandbox.totalIngressBytes ?? 0) + (sandbox.totalEgressBytes ?? 0)) / 1024 ** 3) * 0.15 +
        0.0000006,
      observedAt: new Date().toISOString(),
    }
  }

  async sweepOrphans(activeSessionIds: string[], olderThan: string) {
    const deploymentId = this.config.sandbox.deploymentId
    if (!deploymentId) throw new Error('Sandbox deployment ID is not configured.')
    const activeNames = new Set(activeSessionIds.map(sandboxNameFor))
    const cutoff = Date.parse(olderThan)
    const sandboxes = await this.providerCall('list', () =>
      Sandbox.list({
        ...this.credentials(),
        namePrefix: 'blame-',
        tags: { application: 'blame', deployment: shortTag(deploymentId) },
      }).then((result) => result.toArray())
    )
    let deleted = 0
    for (const sandbox of sandboxes) {
      const createdAt =
        sandbox.createdAt < 10_000_000_000 ? sandbox.createdAt * 1000 : sandbox.createdAt
      if (activeNames.has(sandbox.name) || createdAt >= cutoff) continue
      await this.providerCall('delete-orphan', async () => {
        const resource = await Sandbox.get({
          ...this.credentials(),
          name: sandbox.name,
          resume: false,
        })
        await resource.delete()
      })
      deleted += 1
    }
    return { deleted }
  }

  private async runnerCall<T>(handle: RuntimeHandle, request: Record<string, unknown>) {
    const payload = vercelHandle(handle)
    const sandbox = await this.sandbox(payload, true)
    const requestPath = `${runnerRequestDirectory}/${randomUUID()}.json`
    await sandbox.asUser('root').writeFiles([
      {
        path: requestPath,
        content: JSON.stringify({ ...request, fencingToken: payload.fencingToken }),
        mode: 0o600,
      },
    ])
    const command = await this.providerCall('runner', () =>
      sandbox.runCommand({
        cmd: 'flock',
        args: [
          '--exclusive',
          '--wait',
          '120',
          '/run/blame/control/runner.lock',
          runnerControlBinary,
          '--request',
          requestPath,
        ],
        sudo: true,
        timeoutMs: 120_000,
      })
    )
    const output = await command.stdout()
    let response: RunnerResponse<T>
    try {
      response = JSON.parse(output) as RunnerResponse<T>
    } catch {
      if (command.exitCode !== 0) {
        throw runnerFailure('RUNNER_COMMAND_FAILED', 'Sandbox runner request failed.')
      }
      throw runnerFailure('RUNNER_PROTOCOL_INVALID', 'Sandbox runner returned an invalid response.')
    }
    if (!response.ok) throw runnerFailure(response.error.code, response.error.message)
    if (command.exitCode !== 0) {
      throw runnerFailure('RUNNER_COMMAND_FAILED', 'Sandbox runner request failed.')
    }
    return response.result
  }

  private async publishPlannedRoutes(handle: VercelRuntimeHandle, plan: PreviewExecutionPlan) {
    const sandbox = await this.sandbox(handle, true)
    const entries = await Promise.all(
      plan.networking.gatewayListeners.map(async (listener) => {
        if (!handle.gatewayPorts.includes(listener.sandboxPort)) {
          throw runnerFailure(
            'UNDECLARED_GATEWAY_PORT',
            'Plan contains an undeclared gateway port.'
          )
        }
        const published = await this.routes.publish({
          sessionId: handle.sessionId,
          endpointId: listener.endpointId,
          serviceId: listener.serviceId,
          logicalPort: listener.logicalPort,
          generation: handle.generation,
          upstreamUrl: sandbox.domain(listener.sandboxPort),
        })
        return [`${listener.serviceId}:${listener.endpointId}`, published.publicUrl] as const
      })
    )
    return Object.fromEntries(entries)
  }

  private async bootstrap(sandbox: Sandbox) {
    if (!this.config.sandbox.image) await this.bootstrapStandardRuntime(sandbox)
    const result = await this.providerCall('runner-bootstrap', () =>
      sandbox.runCommand({ cmd: runnerBinary, args: ['bootstrap'], sudo: true, timeoutMs: 120_000 })
    )
    if (result.exitCode !== 0)
      throw runnerFailure('RUNNER_BOOTSTRAP_FAILED', 'Sandbox runner bootstrap failed.')
  }

  private async bootstrapStandardRuntime(sandbox: Sandbox) {
    const url = this.config.sandbox.bootstrapUrl!
    const sha256 = this.config.sandbox.bootstrapSha256!
    const archive = '/tmp/blame-runner.tar.gz'
    await sandbox.runCommand('curl', [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      '--output',
      archive,
      url,
    ])
    const checksum = await sandbox.runCommand('sha256sum', [archive])
    const checksumOutput = await checksum.stdout()
    if (checksum.exitCode !== 0 || !checksumOutput.startsWith(`${sha256} `)) {
      throw runnerFailure('RUNNER_CHECKSUM_MISMATCH', 'Sandbox runner archive checksum mismatch.')
    }
    await sandbox.runCommand({
      cmd: 'tar',
      args: ['-xzf', archive, '-C', '/opt/blame'],
      sudo: true,
      timeoutMs: 120_000,
    })
  }

  private async assertHandshake(sandbox: Sandbox, handle: RuntimeHandle) {
    const response = await this.runnerCall<{
      protocolVersion: number
      runnerVersion: string
      imageDigest: string
    }>(handle, { operation: 'handshake' })
    if (response.protocolVersion !== this.config.sandbox.protocolVersion) {
      throw runnerFailure(
        'RUNNER_PROTOCOL_INCOMPATIBLE',
        `Runner protocol ${response.protocolVersion} is incompatible with control plane protocol ${this.config.sandbox.protocolVersion}.`
      )
    }
    if (response.runnerVersion !== this.config.sandbox.runnerVersion) {
      throw runnerFailure(
        'RUNNER_VERSION_INCOMPATIBLE',
        `Runner version ${response.runnerVersion} is incompatible with control plane version ${this.config.sandbox.runnerVersion}.`
      )
    }
    if (
      this.config.sandbox.image &&
      sandbox.image?.split('@').at(-1) !== this.config.sandbox.image.split('@')[1]
    ) {
      throw runnerFailure(
        'RUNNER_IMAGE_MISMATCH',
        'Runner image digest does not match the pinned image.'
      )
    }
  }

  private sandbox(handle: VercelRuntimeHandle, resume: boolean) {
    return this.providerCall('get', () =>
      Sandbox.get({ ...this.credentials(), name: handle.sandboxName, resume })
    )
  }

  private async findSandbox(handle: VercelRuntimeHandle, resume: boolean) {
    try {
      return await this.sandbox(handle, resume)
    } catch (error) {
      if (providerResourceMissing(error)) return undefined
      throw error
    }
  }

  private credentials() {
    const { accessToken: token, projectId, teamId } = this.config.sandbox
    return token && projectId && teamId ? { token, projectId, teamId } : {}
  }

  private imageOrRuntime(): { image: string } | { runtime: 'node24' } {
    return this.config.sandbox.image ? { image: this.config.sandbox.image } : { runtime: 'node24' }
  }

  private networkPolicy(): NetworkPolicy {
    const bootstrapHost = this.config.sandbox.bootstrapUrl
      ? [new URL(this.config.sandbox.bootstrapUrl).hostname]
      : []
    return vercelNetworkPolicy([
      ...this.config.sandbox.egressAllowlist,
      ...bootstrapHost,
      ...this.config.artifactTransferHosts,
    ]) as NetworkPolicy
  }

  private configurationFailure() {
    const { image, bootstrapUrl, bootstrapSha256, accessToken, projectId, teamId, deploymentId } =
      this.config.sandbox
    if (!deploymentId || !/^[A-Za-z0-9_.-]{1,80}$/.test(deploymentId)) {
      return 'A stable sandbox deployment ID is required.'
    }
    if (!this.config.workspaceEncryptionReady) {
      return 'Dedicated OVH SSE-OMK storage is required for workspace artifacts.'
    }
    if (image && !/@sha256:[a-f0-9]{64}$/i.test(image))
      return 'The runner image must be pinned by digest.'
    if (!image && (!bootstrapUrl || !/^[a-f0-9]{64}$/i.test(bootstrapSha256 ?? ''))) {
      return 'A digest-pinned runner image or checksum-pinned bootstrap archive is required.'
    }
    if (accessToken && (!projectId || !teamId)) {
      return 'Vercel access-token authentication requires project and team IDs.'
    }
    if (!capabilityKeysMatch(this.config.capabilityPublicKey, this.config.capabilityPrivateKey))
      return 'A matching Ed25519 preview capability keypair is required.'
    if (bootstrapUrl && !trustedBootstrapUrl(bootstrapUrl))
      return 'The runner bootstrap archive must use an HTTPS URL without credentials.'
    return undefined
  }

  private assertResourceSize(size: { vcpus: number; memoryGb: number }) {
    const limits = this.limits()
    if (size.vcpus < 1 || size.vcpus > limits.maxVcpus || size.memoryGb !== size.vcpus * 2) {
      throw new PreviewRuntimeError({
        code: 'PROVIDER_QUOTA',
        message: 'Requested sandbox resources do not match current provider limits.',
        retryable: false,
      })
    }
  }

  private async providerCall<T>(operation: string, callback: () => Promise<T>) {
    let lastError: unknown
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await callback()
      } catch (error) {
        lastError = error
        if (!retryableProviderError(error) || attempt === 3) break
        await delay(Math.min(2000, 150 * 2 ** attempt + Math.floor(Math.random() * 100)))
      }
    }
    throw providerFailure(operation, lastError)
  }
}
