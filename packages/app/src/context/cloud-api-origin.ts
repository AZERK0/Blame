export const productionCloudApiUrl = "https://api.blame.so/api/v1"
export const developmentCloudApiUrl = "http://localhost:3333/api/v1"

export function defaultCloudApiUrl(configured: string | undefined, development: boolean) {
  return configured?.trim() || (development ? developmentCloudApiUrl : productionCloudApiUrl)
}
