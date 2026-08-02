import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import {
  PreviewRuntimeError,
  type PreviewExecutionPlan,
  type RuntimeHandle,
  type RuntimeObservation,
} from '@blame/preview-runtime'

export type VercelRuntimeHandle = {
  kind: 'vercel-sandbox'
  sandboxName: string
  sessionId: string
  generation: number
  fencingToken: number
  gatewayPorts: number[]
}

export function vercelHandle(handle: RuntimeHandle): VercelRuntimeHandle {
  const value = handle as unknown as Partial<VercelRuntimeHandle>
  if (
    value.kind !== 'vercel-sandbox' ||
    !value.sandboxName ||
    !value.sessionId ||
    !Number.isSafeInteger(value.fencingToken) ||
    Number(value.fencingToken) < 1
  ) {
    throw new Error('Invalid Vercel runtime handle.')
  }
  return value as VercelRuntimeHandle
}

export function desiredPorts(plan: PreviewExecutionPlan) {
  const ports = Array.from(
    new Set(plan.networking.gatewayListeners.map(({ sandboxPort }) => sandboxPort))
  )
  if (ports.length !== plan.networking.publishedPortCount || ports.length > 15) {
    throw new PreviewRuntimeError({
      code: 'UNSUPPORTED_CAPABILITY',
      message: 'The preview gateway port plan is invalid.',
      retryable: false,
    })
  }
  return ports
}

export function inactiveObservation(
  generation: number,
  host: RuntimeObservation['host'],
  engine: RuntimeObservation['engine']
): RuntimeObservation {
  return { host, engine, generation, services: [] }
}

export function sandboxNameFor(sessionId: string) {
  return `blame-${createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}`
}

export function shortTag(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

export function runnerFailure(code: string, message: string) {
  return new PreviewRuntimeError({
    code: code.includes('HEALTH') ? 'HEALTHCHECK_FAILED' : 'ENGINE_START_FAILED',
    message,
    providerCode: code,
    retryable: false,
  })
}

export function providerFailure(operation: string, error: unknown) {
  const details = error as {
    code?: string
    status?: number
    statusCode?: number
    requestId?: string
  }
  const status = Number(details?.status ?? details?.statusCode ?? 0)
  const code = status === 404 ? 'SANDBOX_NOT_FOUND' : String(details?.code ?? 'VERCEL_UNKNOWN')
  return new PreviewRuntimeError({
    code:
      status === 401 || status === 403
        ? 'PROVIDER_AUTH'
        : status === 429
          ? 'PROVIDER_QUOTA'
          : 'PROVIDER_UNAVAILABLE',
    message: `Vercel Sandbox ${operation} failed.`,
    providerCode: code.slice(0, 80),
    correlationId: details?.requestId?.slice(0, 120),
    retryable: status === 429 || status >= 500 || status === 0,
  })
}

export function retryableProviderError(error: unknown) {
  const details = error as { status?: number; statusCode?: number; code?: string }
  const status = Number(details?.status ?? details?.statusCode ?? 0)
  return status === 0 || status === 429 || status >= 500 || details?.code === 'SANDBOX_SNAPSHOTTING'
}

export function providerResourceMissing(error: unknown) {
  if (error instanceof PreviewRuntimeError) {
    return error.failure.providerCode === 'SANDBOX_NOT_FOUND'
  }
  const details = error as { code?: string; status?: number; statusCode?: number }
  return (
    Number(details?.status ?? details?.statusCode ?? 0) === 404 ||
    String(details?.code ?? '').includes('NOT_FOUND')
  )
}

export function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function capabilityKeysMatch(publicPem: string | undefined, privatePem: string | undefined) {
  if (!publicPem || !privatePem) return false
  try {
    const privateKey = createPrivateKey(privatePem)
    const publicKey = createPublicKey(publicPem)
    if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') {
      return false
    }
    const expected = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
    const actual = publicKey.export({ type: 'spki', format: 'der' })
    return expected.equals(actual)
  } catch {
    return false
  }
}

export function trustedBootstrapUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}
