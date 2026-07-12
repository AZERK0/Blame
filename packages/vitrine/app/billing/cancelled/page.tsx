import type { Metadata } from "next";

import { BillingReturnPage } from "@/components/billing-return-page";

export const metadata: Metadata = {
  title: "Checkout cancelled · Blame",
  description: "Return to Blame after closing checkout.",
  robots: { index: false, follow: false },
};

export default function BillingCancelledPage() {
  return <BillingReturnPage variant="cancelled" />;
}
