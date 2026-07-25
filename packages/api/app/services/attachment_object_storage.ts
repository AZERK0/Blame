import { attachmentsConfig } from '#config/attachments'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type AttachmentObjectMetadata = {
  checksumSha256: string
  contentType: string
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
      new HeadObjectCommand({ Bucket: this.config.s3!.bucket, Key: key })
    )
    return {
      checksumSha256: response.Metadata?.['checksum-sha256'] ?? '',
      contentType: response.ContentType ?? 'application/octet-stream',
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
    const command = new PutObjectCommand({
      Bucket: this.config.s3!.bucket,
      ContentType: metadata.contentType,
      Key: key,
      Metadata: { 'checksum-sha256': metadata.checksumSha256 },
    })
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.config.uploadUrlTtlSeconds,
    })
    return {
      expiresAt: expiresAt(this.config.uploadUrlTtlSeconds),
      headers: uploadHeaders(metadata),
      url,
    }
  }

  async put(key: string, content: Uint8Array, metadata: AttachmentObjectMetadata) {
    await this.client.send(
      new PutObjectCommand({
        Body: content,
        Bucket: this.config.s3!.bucket,
        ContentType: metadata.contentType,
        Key: key,
        Metadata: { 'checksum-sha256': metadata.checksumSha256 },
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

function uploadHeaders(metadata: AttachmentObjectMetadata) {
  return {
    'Content-Type': metadata.contentType,
  }
}
