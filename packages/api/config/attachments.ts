import env from '#start/env'
import app from '@adonisjs/core/services/app'

export type AttachmentsConfig = ReturnType<typeof attachmentsConfig>

export function attachmentsConfig() {
  const driver = env.get('ATTACHMENTS_STORAGE_DRIVER') ?? (app.inTest ? 'memory' : 's3')
  return {
    driver,
    downloadUrlTtlSeconds: env.get('ATTACHMENTS_DOWNLOAD_URL_TTL_SECONDS') ?? 900,
    maxBytes: env.get('ATTACHMENTS_MAX_BYTES') ?? 10_485_760,
    orphanGraceHours: env.get('ATTACHMENTS_ORPHAN_GRACE_HOURS') ?? 24,
    uploadUrlTtlSeconds: env.get('ATTACHMENTS_UPLOAD_URL_TTL_SECONDS') ?? 900,
    s3: driver === 's3' ? s3Config() : null,
  }
}

function s3Config() {
  return {
    accessKeyId: secretValue('ATTACHMENTS_S3_ACCESS_KEY_ID'),
    bucket: stringValue('ATTACHMENTS_S3_BUCKET'),
    endpoint: stringValue('ATTACHMENTS_S3_ENDPOINT'),
    forcePathStyle: env.get('ATTACHMENTS_S3_FORCE_PATH_STYLE') ?? false,
    region: stringValue('ATTACHMENTS_S3_REGION'),
    secretAccessKey: secretValue('ATTACHMENTS_S3_SECRET_ACCESS_KEY'),
  }
}

function stringValue(
  name: 'ATTACHMENTS_S3_BUCKET' | 'ATTACHMENTS_S3_ENDPOINT' | 'ATTACHMENTS_S3_REGION'
) {
  const value = env.get(name)?.trim()
  if (!value) throw new Error(`${name} is required when ATTACHMENTS_STORAGE_DRIVER=s3`)
  return value
}

function secretValue(name: 'ATTACHMENTS_S3_ACCESS_KEY_ID' | 'ATTACHMENTS_S3_SECRET_ACCESS_KEY') {
  const value = env.get(name)?.release().trim()
  if (!value) throw new Error(`${name} is required when ATTACHMENTS_STORAGE_DRIVER=s3`)
  return value
}
