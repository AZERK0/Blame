import type { MetadataRoute } from "next";

import { absoluteSiteUrl, siteOrigin } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: absoluteSiteUrl("/sitemap.xml"),
    host: siteOrigin,
  };
}
