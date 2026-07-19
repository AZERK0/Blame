import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/components/legal-document-page";
import {
  privacyEffectiveDate,
  privacyIntroduction,
  privacyLastUpdated,
  privacyReadyForPublication,
  privacySections,
  privacyVersion,
} from "@/content/privacy-policy";
import { createIndexablePageMetadata } from "@/lib/seo";

export const metadata = createIndexablePageMetadata({
  title: "Privacy Policy · Blame",
  description:
    "How Blame handles personal data across Blame Desktop, its website, cloud services, billing, and support.",
  canonicalPath: "/privacy",
});

export default function PrivacyPolicyPage() {
  if (process.env.NODE_ENV === "production" && !privacyReadyForPublication) {
    notFound();
  }

  return (
    <LegalDocumentPage
      effectiveDate={privacyEffectiveDate}
      introduction={privacyIntroduction}
      lastUpdated={privacyLastUpdated}
      sections={privacySections}
      title="Privacy Policy"
      version={privacyVersion}
    />
  );
}
