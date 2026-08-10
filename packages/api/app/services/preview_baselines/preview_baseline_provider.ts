import type { PreviewExecutionPlan, SourceArtifact } from '@blame/preview-runtime'

export type PreviewBaselineBuildInput = {
  fingerprint: string
  source: SourceArtifact
  plan: PreviewExecutionPlan
  projectId: string
  baseRevision: string
}

export type PreviewBaselineBuildReceipt = {
  provider: string
  providerSnapshotId: string
  ownerSandboxName?: string
  snapshotBytes?: number
}

export interface PreviewBaselineProvider {
  build(input: PreviewBaselineBuildInput): Promise<PreviewBaselineBuildReceipt>
  exists(providerSnapshotId: string): Promise<boolean>
  delete(receipt: { providerSnapshotId: string; ownerSandboxName?: string | null }): Promise<void>
}
