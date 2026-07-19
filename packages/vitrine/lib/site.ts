export const siteOrigin = "https://blame.so";
export const siteUrl = new URL(siteOrigin);

export function absoluteSiteUrl(pathname: string) {
  return new URL(pathname, siteUrl).toString();
}
