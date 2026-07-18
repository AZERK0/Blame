import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalDocumentPage } from "@/components/legal-document-page";
import {
  subprocessorsEffectiveDate,
  subprocessorsIntroduction,
  subprocessorsLastUpdated,
  subprocessorsReadyForPublication,
  subprocessorsSections,
  subprocessorsVersion,
} from "@/content/subprocessor-register";

export const metadata: Metadata = {
  title: "Subprocessor Register · Blame",
  description:
    "The current third parties authorised to process Customer Personal Data on behalf of Blame Business Users.",
};

export default function SubprocessorRegisterPage() {
  if (
    process.env.NODE_ENV === "production" &&
    !subprocessorsReadyForPublication
  ) {
    notFound();
  }

  return (
    <LegalDocumentPage
      effectiveDate={subprocessorsEffectiveDate}
      introduction={subprocessorsIntroduction}
      lastUpdated={subprocessorsLastUpdated}
      sections={subprocessorsSections}
      title="Subprocessor Register"
      version={subprocessorsVersion}
    />
  );
}
