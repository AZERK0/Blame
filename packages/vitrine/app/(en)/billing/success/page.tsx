import type { Metadata } from "next";

import { BillingReturnPage } from "@/components/billing-return-page";

export const metadata: Metadata = {
  title: "Payment confirmed · Blame",
  description: "Return to Blame and activate Premium cloud services.",
  robots: { index: false, follow: false },
};

export default function BillingSuccessPage() {
  return <BillingReturnPage variant="success" />;
}
