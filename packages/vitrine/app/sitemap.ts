import type { MetadataRoute } from "next";

import { absoluteSiteUrl } from "@/lib/site";

const indexablePaths = [
  "/",
  "/pricing",
  "/download",
  "/fr/conditions-generales-de-service",
  "/legal-notice",
  "/legal/dpa",
  "/legal/subprocessors",
  "/privacy",
  "/refund-policy",
  "/terms-of-service",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return indexablePaths.map((pathname) => ({
    url: absoluteSiteUrl(pathname),
  }));
}
