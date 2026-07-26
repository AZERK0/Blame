import type { Metadata } from "next";

import { PasskeyAuthPage } from "@/components/auth/passkey-auth-page";

export const metadata: Metadata = {
  title: "Sign in with a passkey · Blame",
  description: "Complete a secure Blame passkey sign-in.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function PasskeyPage() {
  return <PasskeyAuthPage />;
}
