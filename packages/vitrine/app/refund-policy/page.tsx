import type { Metadata } from "next";
import { LegalPlaceholderPage } from "@/components/legal-placeholder-page";

export const metadata: Metadata = {
  title: "Refund Policy · Blame",
  description: "Blame refund policy.",
};

export default function RefundPolicyPage() {
  return <LegalPlaceholderPage eyebrow="Legal" title="Refund Policy" />;
}
