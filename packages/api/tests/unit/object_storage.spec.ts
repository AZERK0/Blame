import { attachmentObjectStorage } from '#services/attachment_object_storage'
import { S3EncryptedObjectStorage } from '#services/object_storage'
import {
  assertWorkspaceArtifactEncryption,
  workspaceArtifactObjectStorage,
} from '#services/workspace_artifacts/workspace_artifact_object_storage'
import { test } from '@japa/runner'

const checksumSha256 = 'a'.repeat(64)

test.group('object storage', () => {
  test('pins OVH SSE-OMK and checksum headers into workspace uploads', async ({ assert }) => {
    const storage = new S3EncryptedObjectStorage({
      accessKeyId: 'test-access-key',
      bucket: 'blame-prod-workspace-gra',
      downloadUrlTtlSeconds: 300,
      endpoint: 'https://s3.gra.io.cloud.ovh.net',
      forcePathStyle: false,
      region: 'gra',
      secretAccessKey: 'test-secret-key',
      uploadUrlTtlSeconds: 300,
    })
    const upload = await storage.presignUpload('preview-runtime/session/source/artifact.tar.gz', {
      checksumSha256,
      contentType: 'application/gzip',
      encryptionScope: 'session',
      size: 42,
    })

    assert.equal(upload.headers['x-amz-server-side-encryption'], 'AES256')
    assert.equal(upload.headers['x-amz-meta-checksum-sha256'], checksumSha256)
    assert.equal(upload.headers['x-amz-meta-encryption-scope'], 'session')
    assert.equal(upload.headers['Content-Type'], 'application/gzip')
    assert.equal(new URL(upload.url).hostname, 'blame-prod-workspace-gra.s3.gra.io.cloud.ovh.net')
  })

  test('rejects workspace objects whose SSE-OMK encryption is absent', ({ assert }) => {
    const metadata = {
      checksumSha256,
      contentType: 'application/gzip',
      encryptionScope: 'session',
      size: 42,
    }
    assert.throws(
      () => assertWorkspaceArtifactEncryption(metadata),
      /not encrypted with OVH SSE-OMK/
    )
    assert.doesNotThrow(() =>
      assertWorkspaceArtifactEncryption({ ...metadata, serverSideEncryption: 'AES256' })
    )
  })

  test('keeps conversation attachments and preview workspaces isolated', async ({ assert }) => {
    const key = 'same/logical/key'
    await attachmentObjectStorage().put(key, Uint8Array.from([1]), {
      checksumSha256,
      contentType: 'application/octet-stream',
      size: 1,
    })

    await assert.rejects(
      () => workspaceArtifactObjectStorage().content(key),
      /not found|does not exist/i
    )
  })
})
