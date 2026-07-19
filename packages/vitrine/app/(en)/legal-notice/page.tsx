import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/components/legal-document-page";
import {
  legalNoticeEffectiveDate,
  legalNoticeIntroduction,
  legalNoticeLastUpdated,
  legalNoticeReadyForPublication,
  legalNoticeSections,
  legalNoticeVersion,
} from "@/content/legal-notice";
import { createIndexablePageMetadata } from "@/lib/seo";

export const metadata = createIndexablePageMetadata({
  title: "Legal Notice · Blame",
  description: "Legal information for Blame.",
  canonicalPath: "/legal-notice",
});

export default function LegalNoticePage() {
  if (
    process.env.NODE_ENV === "production" &&
    !legalNoticeReadyForPublication
  ) {
    notFound();
  }

  return (
    <LegalDocumentPage
      effectiveDate={legalNoticeEffectiveDate}
      introduction={legalNoticeIntroduction}
      lastUpdated={legalNoticeLastUpdated}
      sections={legalNoticeSections}
      title="Legal Notice"
      version={legalNoticeVersion}
    />
  );
}
