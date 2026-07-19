import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/components/legal-document-page";
import {
  frenchTermsEffectiveDate,
  frenchTermsIntroduction,
  frenchTermsLastUpdated,
  frenchTermsReadyForPublication,
  frenchTermsSections,
  frenchTermsVersion,
} from "@/content/french-terms-of-service";

export const metadata: Metadata = {
  title: "Conditions Générales de Service et de Vente · Blame",
  description:
    "Conditions contractuelles françaises applicables aux services Blame.",
};

export default function FrenchTermsOfServicePage() {
  if (
    process.env.NODE_ENV === "production" &&
    !frenchTermsReadyForPublication
  ) {
    notFound();
  }

  return (
    <LegalDocumentPage
      languageRoutes={{
        englishHref: "/terms-of-service",
        frenchHref: "/fr/conditions-generales-de-service",
      }}
      effectiveDate={frenchTermsEffectiveDate}
      introduction={frenchTermsIntroduction}
      language="fr"
      lastUpdated={frenchTermsLastUpdated}
      sections={frenchTermsSections}
      title="Conditions Générales de Service et de Vente"
      version={frenchTermsVersion}
    />
  );
}
