import type { Metadata } from "next";

import { ConsumerContractActionPage } from "@/components/consumer-contract-action-page";

export const metadata: Metadata = {
  title: "Renoncer au contrat ici · Blame",
  description:
    "Fonctionnalité gratuite de rétractation en ligne d'un contrat Blame éligible.",
  robots: { index: false, follow: true },
};

export default function FrenchWithdrawalPage() {
  return <ConsumerContractActionPage language="fr" />;
}
