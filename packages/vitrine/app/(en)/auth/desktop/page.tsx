import type { Metadata } from "next";

import { DesktopAuthPage } from "@/components/desktop-auth-page";

export const metadata: Metadata = {
  title: "Connect Blame",
  description: "Complete a secure Blame desktop sign-in.",
  robots: { index: false, follow: false },
};

export default function DesktopAuthorizationPage() {
  return <DesktopAuthPage />;
}
