import { createHash } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { extract } from 'tar-stream'

const maxEntries = 25_000
const maxExpandedBytes = 1_000_000_000
const blockedBasenames = new Set(['.env', '.npmrc', 'id_rsa', 'id_ed25519', 'known_hosts'])

export type ValidatedSourceArtifact = {
  entries: number
  expandedBytes: number
  archiveSha256: string
}

export async function validateSourceArtifact(
  content: Uint8Array,
  expected: { sha256: string; size: number }
): Promise<ValidatedSourceArtifact> {
  if (content.byteLength !== expected.size) throw new Error('Source artifact size mismatch.')
  const archiveSha256 = createHash('sha256').update(content).digest('hex')
  if (archiveSha256 !== expected.sha256) throw new Error('Source artifact checksum mismatch.')
  const parser = extract()
  let entries = 0
  let expandedBytes = 0
  let manifestFound = false
  const completion = new Promise<void>((resolve, reject) => {
    parser.on('entry', (header, stream, next) => {
      try {
        entries += 1
        if (entries > maxEntries) throw new Error('Source artifact contains too many entries.')
        const path = safeArchivePath(header.name)
        assertAllowedPath(path)
        if (header.type === 'symlink' || header.type === 'link')
          safeSymlink(path, header.linkname ?? '')
        if (!['file', 'directory', 'symlink', 'link'].includes(header.type ?? 'file')) {
          throw new Error('Source artifact contains an unsupported entry type.')
        }
        expandedBytes += header.size ?? 0
        if (expandedBytes > maxExpandedBytes)
          throw new Error('Source artifact expands beyond its limit.')
        if (path === '.blame/source-manifest.json') manifestFound = true
        stream.on('error', reject)
        stream.on('end', next)
        stream.resume()
      } catch (error) {
        stream.resume()
        reject(error)
      }
    })
    parser.once('finish', () => {
      if (!manifestFound) reject(new Error('Source artifact manifest is missing.'))
      else resolve()
    })
    parser.once('error', reject)
  })
  const source = Readable.from(Buffer.from(content))
  if (gzip(content)) source.pipe(createGunzip()).pipe(parser)
  else source.pipe(parser)
  await completion
  return { entries, expandedBytes, archiveSha256 }
}

function safeArchivePath(value: string) {
  const normalized = value.replaceAll('\\', '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.includes('\0') ||
    normalized.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error('Source artifact contains path traversal.')
  }
  return normalized.replace(/^\.\//, '')
}

function assertAllowedPath(path: string) {
  const segments = path.toLowerCase().split('/')
  const basename = segments.at(-1) ?? ''
  if (
    segments.includes('.git') ||
    segments.includes('node_modules') ||
    segments.includes('.ssh') ||
    (basename.startsWith('.env') && basename !== '.env.example') ||
    blockedBasenames.has(basename) ||
    path.toLowerCase() === '.docker/config.json'
  ) {
    throw new Error('Source artifact contains a forbidden path.')
  }
}

function safeSymlink(path: string, target: string) {
  if (!target || target.startsWith('/') || /^[a-z]:/i.test(target)) {
    throw new Error('Source artifact contains an unsafe symlink.')
  }
  const base = path.split('/').slice(0, -1)
  for (const segment of target.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!base.length) throw new Error('Source artifact symlink escapes the workspace.')
      base.pop()
    } else base.push(segment)
  }
}

function gzip(content: Uint8Array) {
  return content[0] === 0x1f && content[1] === 0x8b
}
