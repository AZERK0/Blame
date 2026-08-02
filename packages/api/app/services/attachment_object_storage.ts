import { attachmentsConfig } from '#config/attachments'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const checksumMetadataHeader = 'x-amz-meta-checksum-sha256'
const checksumHeader = 'x-amz-checksum-sha256'
const encryptionHeader = 'x-amz-server-side-encryption'
const encryptionContextHeader = 'x-amz-server-side-encryption-context'
const encryptionKeyHeader = 'x-amz-server-side-encryption-aws-kms-key-id'

export type AttachmentObjectMetadata = {
  checksumSha256: string
  contentType: string
  encryptionScope?: string
  size: number
}

export type AttachmentUploadTarget = {
  expiresAt: string
  headers: Record<string, string>
  url: string
}

export interface AttachmentObjectStorage {
  content(key: string): Promise<Uint8Array>
  delete(keys: string[]): Promise<void>
  head(key: string): Promise<AttachmentObjectMetadata>
  presignDownload(key: string, name: string): Promise<string>
  presignUpload(key: string, metadata: AttachmentObjectMetadata): Promise<AttachmentUploadTarget>
  put(key: string, content: Uint8Array, metadata: AttachmentObjectMetadata): Promise<void>
}

let storage: AttachmentObjectStorage | undefined

export function attachmentObjectStorage() {
  storage ??= createAttachmentObjectStorage()
  return storage
}

function createAttachmentObjectStorage() {
  const config = attachmentsConfig()
  if (config.driver === 'memory') return new MemoryAttachmentObjectStorage(config)
  return new S3AttachmentObjectStorage(config)
}

class S3AttachmentObjectStorage implements AttachmentObjectStorage {
  private client: S3Client

  constructor(private config: ReturnType<typeof attachmentsConfig>) {
    const s3 = config.s3!
    this.client = new S3Client({
      credentials: {
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      },
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      region: s3.region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  }

  async content(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.s3!.bucket, Key: key })
    )
    if (!response.Body) throw new Error('Attachment object has no content')
    return response.Body.transformToByteArray()
  }

  async delete(keys: string[]) {
    for (const batch of batches(keys, 1000)) await this.deleteBatch(batch)
  }

  async head(key: string) {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.s3!.bucket, Key: key, ChecksumMode: 'ENABLED' })
    )
    return {
      checksumSha256:
        decodedChecksum(response.ChecksumSHA256) ?? response.Metadata?.['checksum-sha256'] ?? '',
      contentType: response.ContentType ?? 'application/octet-stream',
      encryptionScope: response.Metadata?.['encryption-scope'],
      size: response.ContentLength ?? -1,
    }
  }

  presignDownload(key: string, name: string) {
    const command = new GetObjectCommand({
      Bucket: this.config.s3!.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(name),
    })
    return getSignedUrl(this.client, command, {
      expiresIn: this.config.downloadUrlTtlSeconds,
    })
  }

  async presignUpload(key: string, metadata: AttachmentObjectMetadata) {
    const encryption = encryptionOptions(this.config, metadata)
    const command = new PutObjectCommand({
      Bucket: this.config.s3!.bucket,
      ContentType: metadata.contentType,
      ChecksumSHA256: encodedChecksum(metadata.checksumSha256),
      Key: key,
      Metadata: objectMetadata(metadata),
      ...encryption.command,
    })
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.config.uploadUrlTtlSeconds,
      signableHeaders: new Set(['content-type']),
      unhoistableHeaders: new Set([
        checksumHeader,
        checksumMetadataHeader,
        encryptionHeader,
        encryptionContextHeader,
        encryptionKeyHeader,
      ]),
    })
    return {
      expiresAt: expiresAt(this.config.uploadUrlTtlSeconds),
      headers: uploadHeaders(metadata, encryption.headers),
      url,
    }
  }

  async put(key: string, content: Uint8Array, metadata: AttachmentObjectMetadata) {
    const encryption = encryptionOptions(this.config, metadata)
    await this.client.send(
      new PutObjectCommand({
        Body: content,
        Bucket: this.config.s3!.bucket,
        ContentType: metadata.contentType,
        ChecksumSHA256: encodedChecksum(metadata.checksumSha256),
        Key: key,
        Metadata: objectMetadata(metadata),
        ...encryption.command,
      })
    )
  }

  private async deleteBatch(keys: string[]) {
    if (!keys.length) return
    const response = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.config.s3!.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      })
    )
    if (response.Errors?.length) throw new Error('Unable to delete attachment objects')
  }
}

class MemoryAttachmentObjectStorage implements AttachmentObjectStorage {
  private objects = new Map<string, { content: Uint8Array; metadata: AttachmentObjectMetadata }>()

  constructor(private config: ReturnType<typeof attachmentsConfig>) {}

  async content(key: string) {
    const object = this.object(key)
    return object.content
  }

  async delete(keys: string[]) {
    keys.forEach((key) => this.objects.delete(key))
  }

  async head(key: string) {
    return this.object(key).metadata
  }

  async presignDownload(key: string) {
    this.object(key)
    return `memory://attachments/${encodeURIComponent(key)}`
  }

  async presignUpload(key: string, metadata: AttachmentObjectMetadata) {
    return {
      expiresAt: expiresAt(this.config.uploadUrlTtlSeconds),
      headers: uploadHeaders(metadata),
      url: `memory://uploads/${encodeURIComponent(key)}`,
    }
  }

  async put(key: string, content: Uint8Array, metadata: AttachmentObjectMetadata) {
    this.objects.set(key, { content: Uint8Array.from(content), metadata })
  }

  private object(key: string) {
    const object = this.objects.get(key)
    if (!object) throw new Error('Attachment object not found')
    return object
  }
}

function batches<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size)
  )
}

function contentDisposition(name: string) {
  return `inline; filename*=UTF-8''${encodeURIComponent(name)}`
}

function expiresAt(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

function uploadHeaders(metadata: AttachmentObjectMetadata, encryption?: Record<string, string>) {
  return {
    'Content-Type': metadata.contentType,
    [checksumHeader]: encodedChecksum(metadata.checksumSha256),
    [checksumMetadataHeader]: metadata.checksumSha256,
    ...(encryption ?? { [encryptionHeader]: 'AES256' }),
  }
}

function objectMetadata(metadata: AttachmentObjectMetadata) {
  return {
    'checksum-sha256': metadata.checksumSha256,
    ...(metadata.encryptionScope ? { 'encryption-scope': metadata.encryptionScope } : {}),
  }
}

function encryptionOptions(
  config: ReturnType<typeof attachmentsConfig>,
  metadata: AttachmentObjectMetadata
) {
  if (!metadata.encryptionScope) {
    return { command: { ServerSideEncryption: 'AES256' as const } }
  }
  const keyId = config.s3?.kmsKeyId
  if (!keyId)
    throw new Error('Session-scoped workspace encryption requires ATTACHMENTS_S3_KMS_KEY_ID')
  const context = Buffer.from(
    JSON.stringify({ blamePreviewSessionId: metadata.encryptionScope })
  ).toString('base64')
  return {
    command: {
      ServerSideEncryption: 'aws:kms' as const,
      SSEKMSKeyId: keyId,
      SSEKMSEncryptionContext: context,
    },
    headers: {
      [encryptionHeader]: 'aws:kms',
      [encryptionKeyHeader]: keyId,
      [encryptionContextHeader]: context,
    },
  }
}

function encodedChecksum(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid attachment checksum')
  return Buffer.from(value, 'hex').toString('base64')
}

function decodedChecksum(value: string | undefined) {
  if (!value) return undefined
  const decoded = Buffer.from(value, 'base64')
  return decoded.byteLength === 32 ? decoded.toString('hex') : undefined
}
