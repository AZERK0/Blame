import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/components/legal-document-page";
import {
  termsEffectiveDate,
  termsIntroduction,
  termsLastUpdated,
  termsReadyForPublication,
  termsSections,
  termsVersion,
} from "@/content/terms-of-service";

export const metadata: Metadata = {
  title: "Terms of Service · Blame",
  description:
    "Terms governing access to and use of Blame Desktop and related services.",
};

export default function TermsOfServicePage() {
  if (process.env.NODE_ENV === "production" && !termsReadyForPublication) {
    notFound();
  }

  return (
    <LegalDocumentPage
      effectiveDate={termsEffectiveDate}
      introduction={termsIntroduction}
      lastUpdated={termsLastUpdated}
      sections={termsSections}
      title="Terms of Service"
      version={termsVersion}
    />
  );
}
