import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Legal Notice · Blame",
  description: "Legal information for Blame.",
};

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
