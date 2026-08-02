import { previewRuntimeConfig, type PreviewRuntimeConfig } from '#config/preview_runtime'
import { createPrivateKey, randomBytes, sign } from 'node:crypto'

export type PreviewCapabilityRoute = {
  sessionId: string
  endpointId: string
  generation: number
}

export default class PreviewCapabilityService {
  constructor(private readonly config: PreviewRuntimeConfig = previewRuntimeConfig()) {}

  issue(route: PreviewCapabilityRoute, ttlSeconds = 30) {
    const pem = this.config.capabilityPrivateKey
    if (!pem) throw new Error('Preview capability signing is not configured.')
    const key = createPrivateKey(pem)
    if (key.asymmetricKeyType !== 'ed25519')
      throw new Error('Preview capability key must be Ed25519.')
    const now = Math.floor(Date.now() / 1000)
    const header = encode({ alg: 'EdDSA', typ: 'JWT' })
    const claims = {
      iss: 'blame-preview-edge',
      aud: 'blame-sandbox-gateway',
      sessionId: route.sessionId,
      endpointId: route.endpointId,
      generation: route.generation,
      iat: now,
      exp: now + Math.min(60, Math.max(5, ttlSeconds)),
      nonce: randomBytes(16).toString('base64url'),
    }
    const payload = encode(claims)
    const signature = sign(null, Buffer.from(`${header}.${payload}`), key).toString('base64url')
    return { token: `${header}.${payload}.${signature}`, expiresAt: claims.exp }
  }
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
