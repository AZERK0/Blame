import { validateSourceDeltaArtifact } from '#services/workspace_artifacts/source_artifact_validator'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { pack } from 'tar-stream'
import { test } from '@japa/runner'

test.group('preview source delta validator', () => {
  test('returns the manifest identity used to authorize a live delta', async ({ assert }) => {
    const baseHash = 'a'.repeat(64)
    const finalHash = 'b'.repeat(64)
    const content = await deltaArchive({ version: 1, baseHash, finalHash })

    const validated = await validateSourceDeltaArtifact(content, {
      sha256: createHash('sha256').update(content).digest('hex'),
      size: content.byteLength,
    })

    assert.equal(validated.baseHash, baseHash)
    assert.equal(validated.finalHash, finalHash)
  })

  test('rejects a delta without a valid manifest identity', async ({ assert }) => {
    const content = await deltaArchive({
      version: 1,
      baseHash: 'invalid',
      finalHash: 'b'.repeat(64),
    })

    await assert.rejects(
      () =>
        validateSourceDeltaArtifact(content, {
          sha256: createHash('sha256').update(content).digest('hex'),
          size: content.byteLength,
        }),
      'Source delta manifest identity is invalid.'
    )
  })
})

async function deltaArchive(manifest: Record<string, unknown>) {
  const archive = pack()
  const gzip = createGzip()
  const chunks: Buffer[] = []
  gzip.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const writing = pipeline(archive, gzip)
  archive.entry({ name: '.blame/delta-manifest.json' }, JSON.stringify(manifest))
  archive.finalize()
  await writing
  return Buffer.concat(chunks)
}
