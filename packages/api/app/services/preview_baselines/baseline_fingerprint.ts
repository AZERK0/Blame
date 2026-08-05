import { createHash } from 'node:crypto'

export const baselineProtocolVersion = 1

export type PreviewBaselineFingerprintInput = {
  projectId: string
  baseRevision: string
  sanitizedTreeHash: string
  planHash: string
  lockfileHash: string
  runnerImageDigest: string
  runnerVersion: string
  protocolVersion: number
  cachePolicyVersion: string
}

export function previewBaselineFingerprint(input: PreviewBaselineFingerprintInput) {
  const canonical = [
    input.projectId,
    input.baseRevision,
    input.sanitizedTreeHash,
    input.planHash,
    input.lockfileHash,
    input.runnerImageDigest,
    input.runnerVersion,
    String(input.protocolVersion),
    input.cachePolicyVersion,
  ].join('\0')
  return createHash('sha256').update(canonical).digest('hex')
}

export function sanitizedFingerprintPart(value: string, name: string) {
  if (!value || value.length > 512 || /[\0\r\n]/.test(value)) {
    throw new Error(`${name} is invalid.`)
  }
  return value
}
