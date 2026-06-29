import type { NextConfig } from 'next'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(packageRoot, '../..')

const nextConfig: NextConfig = {
  turbopack: {
    root: workspaceRoot,
  },
}

export default nextConfig
