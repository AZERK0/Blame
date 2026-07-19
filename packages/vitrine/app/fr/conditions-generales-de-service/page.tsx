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
import { createIndexablePageMetadata } from "@/lib/seo";

export const metadata = createIndexablePageMetadata({
  title: "Conditions Générales de Service et de Vente · Blame",
  description:
    "Conditions contractuelles françaises applicables aux services Blame.",
  canonicalPath: "/fr/conditions-generales-de-service",
  locale: "fr_FR",
  languageAlternates: {
    en: "/terms-of-service",
    fr: "/fr/conditions-generales-de-service",
    "x-default": "/terms-of-service",
  },
});

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
