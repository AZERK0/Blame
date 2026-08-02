import { isIP } from 'node:net'

export type SandboxNetworkRule = {
  domain: string
  method?: string[]
  pathPrefix?: string
  brokeredHeaders?: Record<string, string>
  forwardUrl?: string
}

const protectedCidrs = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '224.0.0.0/4',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
]

export function vercelNetworkPolicy(domains: string[], rules: SandboxNetworkRule[] = []) {
  const allow: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(
    uniqueDomains(domains).map((domain) => [domain, []])
  )
  for (const rule of rules) {
    const entry: Record<string, unknown> = {}
    if (rule.method || rule.pathPrefix) {
      entry.match = {
        ...(rule.method ? { method: rule.method } : {}),
        ...(rule.pathPrefix ? { path: { startsWith: rule.pathPrefix } } : {}),
      }
    }
    if (rule.brokeredHeaders) entry.transform = [{ headers: rule.brokeredHeaders }]
    if (rule.forwardUrl) entry.forwardURL = rule.forwardUrl
    allow[canonicalDomain(rule.domain)] = [...(allow[canonicalDomain(rule.domain)] ?? []), entry]
  }
  return {
    allow,
    subnets: { deny: protectedCidrs },
  }
}

function uniqueDomains(values: string[]) {
  return Array.from(new Set(values.map(canonicalDomain)))
}

function canonicalDomain(value: string) {
  const domain = value.trim().toLowerCase()
  const hostname = domain.startsWith('*.') ? domain.slice(2) : domain
  if (
    isIP(hostname) !== 0 ||
    hostname.length > 253 ||
    !hostname.includes('.') ||
    hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error(`Invalid sandbox egress domain: ${value}`)
  }
  return domain
}
