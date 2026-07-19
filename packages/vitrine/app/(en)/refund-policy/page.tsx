import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/components/legal-document-page";
import {
  refundEffectiveDate,
  refundIntroduction,
  refundLastUpdated,
  refundReadyForPublication,
  refundSections,
  refundVersion,
} from "@/content/refund-policy";
import { createIndexablePageMetadata } from "@/lib/seo";

export const metadata = createIndexablePageMetadata({
  title: "Refund Policy · Blame",
  description: "Blame refund policy.",
  canonicalPath: "/refund-policy",
});

export default function RefundPolicyPage() {
  if (process.env.NODE_ENV === "production" && !refundReadyForPublication) {
    notFound();
  }

  return (
    <LegalDocumentPage
      effectiveDate={refundEffectiveDate}
      introduction={refundIntroduction}
      lastUpdated={refundLastUpdated}
      sections={refundSections}
      title="Refund Policy"
      version={refundVersion}
    />
  );
}
