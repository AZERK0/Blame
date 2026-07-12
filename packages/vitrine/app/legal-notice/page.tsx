import type { Metadata } from "next";
import { LegalPlaceholderPage } from "@/components/legal-placeholder-page";

export const metadata: Metadata = {
  title: "Legal Notice · Blame",
  description: "Legal information for Blame.",
};

export default function LegalNoticePage() {
  return <LegalPlaceholderPage eyebrow="Company" title="Legal Notice" />;
}
