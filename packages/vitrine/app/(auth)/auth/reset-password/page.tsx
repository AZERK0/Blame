import type { Metadata } from "next";

import { ResetPasswordPage } from "@/components/auth/reset-password-page";

export const metadata: Metadata = {
  title: "Reset your password · Blame",
  description: "Choose a new password for your Blame account.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function PasswordResetPage() {
  return <ResetPasswordPage />;
}
