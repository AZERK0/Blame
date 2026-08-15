import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { createGzip } from 'node:zlib'
import { pack } from 'tar-stream'
import { pipeline } from 'node:stream/promises'
import { validateDeploymentSource } from '#services/deployments/deployment_source_validator'

test.group('deployment source validation', () => {
  test('extracts portable source files and computes Vercel SHA-1 digests', async ({ assert }) => {
    const archive = await sourceArchive([
      ['index.html', '<h1>Hello</h1>'],
      ['src/app.ts', 'export const app = true'],
    ])
    const files = await validateDeploymentSource(archive, metadata(archive))
    assert.deepEqual(
      files.map(({ file }) => file),
      ['index.html', 'src/app.ts']
    )
    assert.equal(files[0]?.sha, createHash('sha1').update('<h1>Hello</h1>').digest('hex'))
  })

  test('rejects secrets, forbidden paths and case collisions', async ({ assert }) => {
    for (const entries of [
      [['.env', 'SECRET=value']],
      [['token.txt', 'AKIAABCDEFGHIJKLMNOP']],
      [
        ['README.md', 'one'],
        ['readme.md', 'two'],
      ],
    ]) {
      const archive = await sourceArchive(entries)
      await assert.rejects(() => validateDeploymentSource(archive, metadata(archive)))
    }
  })
})

async function sourceArchive(entries: string[][]) {
  const archive = pack()
  const gzip = createGzip()
  const chunks: Buffer[] = []
  gzip.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  const writing = pipeline(archive, gzip)
  for (const [name, value] of entries) archive.entry({ name, type: 'file' }, value)
  archive.finalize()
  await writing
  return Buffer.concat(chunks)
}

function metadata(content: Buffer) {
  return { sha256: createHash('sha256').update(content).digest('hex'), size: content.byteLength }
}
