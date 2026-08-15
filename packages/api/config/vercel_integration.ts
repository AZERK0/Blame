import env from '#start/env'

export type VercelIntegrationConfig = {
  clientId: string
  clientSecret: string
  slug: string
  redirectUri: string
}

export function vercelIntegrationConfig(): VercelIntegrationConfig | undefined {
  const clientId = env.get('VERCEL_INTEGRATION_CLIENT_ID')
  const clientSecret = env.get('VERCEL_INTEGRATION_CLIENT_SECRET')?.release()
  const slug = env.get('VERCEL_INTEGRATION_SLUG')
  const redirectUri =
    env.get('VERCEL_INTEGRATION_REDIRECT_URI') ??
    new URL('/api/v1/integrations/vercel/callback', env.get('APP_URL')).toString()
  if (!clientId || !clientSecret || !slug) return undefined
  return {
    clientId,
    clientSecret,
    slug,
    redirectUri,
  }
}
