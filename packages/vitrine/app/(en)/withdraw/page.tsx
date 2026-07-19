import type { Metadata } from "next";

import { ConsumerContractActionPage } from "@/components/consumer-contract-action-page";

export const metadata: Metadata = {
  title: "Withdraw from contract here · Blame",
  description:
    "Free online withdrawal facility for an eligible Blame contract.",
  robots: { index: false, follow: true },
};

export default function WithdrawalPage() {
  return <ConsumerContractActionPage />;
}
