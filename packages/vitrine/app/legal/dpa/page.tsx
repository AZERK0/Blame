import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/components/legal-document-page";
import {
  dpaEffectiveDate,
  dpaIntroduction,
  dpaLastUpdated,
  dpaReadyForPublication,
  dpaSections,
  dpaVersion,
} from "@/content/data-processing-addendum";

export const metadata: Metadata = {
  title: "Data Processing Addendum · Blame",
  description:
    "Data-protection terms governing Blame's processing of Customer Personal Data for Business Users.",
};

export default function DataProcessingAddendumPage() {
  if (process.env.NODE_ENV === "production" && !dpaReadyForPublication) {
    notFound();
  }

  return (
    <LegalDocumentPage
      effectiveDate={dpaEffectiveDate}
      introduction={dpaIntroduction}
      lastUpdated={dpaLastUpdated}
      sections={dpaSections}
      title="Data Processing Addendum"
      version={dpaVersion}
    />
  );
}
