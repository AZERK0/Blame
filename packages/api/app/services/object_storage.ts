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

export type StoredObjectMetadata = {
  checksumSha256: string
  contentType: string
  encryptionScope?: string
  serverSideEncryption?: string
  size: number
}

export type ObjectUploadTarget = {
  expiresAt: string
  headers: Record<string, string>
  url: string
}

export interface BlameObjectStorage {
  content(key: string): Promise<Uint8Array>
  delete(keys: string[]): Promise<void>
  head(key: string): Promise<StoredObjectMetadata>
  presignDownload(key: string, name: string): Promise<string>
  presignUpload(key: string, metadata: StoredObjectMetadata): Promise<ObjectUploadTarget>
  put(key: string, content: Uint8Array, metadata: StoredObjectMetadata): Promise<void>
}

export type S3ObjectStorageConfig = {
  accessKeyId: string
  bucket: string
  downloadUrlTtlSeconds: number
  endpoint: string
  forcePathStyle: boolean
  region: string
  secretAccessKey: string
  uploadUrlTtlSeconds: number
}

/**
 * S3-compatible storage which always requests AES-256 server-side encryption.
 * On OVH Object Storage this maps to SSE-OMK, whose keys are managed by OVH.
 */
export class S3EncryptedObjectStorage implements BlameObjectStorage {
  private client: S3Client

  constructor(private config: S3ObjectStorageConfig) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
  }

  async content(key: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key })
    )
    if (!response.Body) throw new Error('Stored object has no content')
    return response.Body.transformToByteArray()
  }

  async delete(keys: string[]) {
    for (const batch of batches(keys, 1000)) await this.deleteBatch(batch)
  }

  async head(key: string) {
    const response = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key, ChecksumMode: 'ENABLED' })
    )
    return {
      checksumSha256:
        decodedChecksum(response.ChecksumSHA256) ?? response.Metadata?.['checksum-sha256'] ?? '',
      contentType: response.ContentType ?? 'application/octet-stream',
      encryptionScope: response.Metadata?.['encryption-scope'],
      serverSideEncryption: response.ServerSideEncryption,
      size: response.ContentLength ?? -1,
    }
  }

  presignDownload(key: string, name: string) {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(name),
    })
    return getSignedUrl(this.client, command, {
      expiresIn: this.config.downloadUrlTtlSeconds,
    })
  }

  async presignUpload(key: string, metadata: StoredObjectMetadata) {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      ContentType: metadata.contentType,
      ChecksumSHA256: encodedChecksum(metadata.checksumSha256),
      Key: key,
      Metadata: objectMetadata(metadata),
      ServerSideEncryption: 'AES256',
    })
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.config.uploadUrlTtlSeconds,
      signableHeaders: new Set(['content-type']),
      unhoistableHeaders: new Set([checksumHeader, checksumMetadataHeader, encryptionHeader]),
    })
    return {
      expiresAt: expiresAt(this.config.uploadUrlTtlSeconds),
      headers: uploadHeaders(metadata),
      url,
    }
  }

  async put(key: string, content: Uint8Array, metadata: StoredObjectMetadata) {
    await this.client.send(
      new PutObjectCommand({
        Body: content,
        Bucket: this.config.bucket,
        ContentType: metadata.contentType,
        ChecksumSHA256: encodedChecksum(metadata.checksumSha256),
        Key: key,
        Metadata: objectMetadata(metadata),
        ServerSideEncryption: 'AES256',
      })
    )
  }

  private async deleteBatch(keys: string[]) {
    if (!keys.length) return
    const response = await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.config.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      })
    )
    if (response.Errors?.length) throw new Error('Unable to delete stored objects')
  }
}

export class MemoryObjectStorage implements BlameObjectStorage {
  private objects = new Map<string, { content: Uint8Array; metadata: StoredObjectMetadata }>()

  constructor(
    private readonly uploadUrlTtlSeconds: number,
    private readonly namespace: string
  ) {}

  async content(key: string) {
    return this.object(key).content
  }

  async delete(keys: string[]) {
    keys.forEach((key) => this.objects.delete(key))
  }

  async head(key: string) {
    return this.object(key).metadata
  }

  async presignDownload(key: string) {
    this.object(key)
    return `memory://${this.namespace}/${encodeURIComponent(key)}`
  }

  async presignUpload(key: string, metadata: StoredObjectMetadata) {
    return {
      expiresAt: expiresAt(this.uploadUrlTtlSeconds),
      headers: uploadHeaders(metadata),
      url: `memory://${this.namespace}-uploads/${encodeURIComponent(key)}`,
    }
  }

  async put(key: string, content: Uint8Array, metadata: StoredObjectMetadata) {
    this.objects.set(key, { content: Uint8Array.from(content), metadata })
  }

  private object(key: string) {
    const object = this.objects.get(key)
    if (!object) throw new Error('Stored object not found')
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

function uploadHeaders(metadata: StoredObjectMetadata) {
  return {
    'Content-Type': metadata.contentType,
    [checksumHeader]: encodedChecksum(metadata.checksumSha256),
    [checksumMetadataHeader]: metadata.checksumSha256,
    [encryptionHeader]: 'AES256',
  }
}

function objectMetadata(metadata: StoredObjectMetadata) {
  return {
    'checksum-sha256': metadata.checksumSha256,
    ...(metadata.encryptionScope ? { 'encryption-scope': metadata.encryptionScope } : {}),
  }
}

function encodedChecksum(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid object checksum')
  return Buffer.from(value, 'hex').toString('base64')
}

function decodedChecksum(value: string | undefined) {
  if (!value) return undefined
  const decoded = Buffer.from(value, 'base64')
  return decoded.byteLength === 32 ? decoded.toString('hex') : undefined
}
