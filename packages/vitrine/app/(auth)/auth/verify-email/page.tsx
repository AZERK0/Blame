import type { Metadata } from "next";

import { VerifyEmailPage } from "@/components/auth/verify-email-page";

export const metadata: Metadata = {
  title: "Verify your email · Blame",
  description: "Confirm your Blame email address.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function EmailVerificationPage() {
  return <VerifyEmailPage />;
}
