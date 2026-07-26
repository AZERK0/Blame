import env from '#start/env'

export const siteUrl = env.get('BLAME_SITE_URL', 'https://blame.so').replace(/\/$/, '')

export function sitePageUrl(pathname: string, parameters?: Record<string, string>) {
  const url = new URL(pathname, siteUrl)
  Object.entries(parameters ?? {}).forEach(([name, value]) => url.searchParams.set(name, value))
  return url.toString()
}
