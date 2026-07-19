import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Refund Policy · Blame",
  description: "Blame refund policy.",
};

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
