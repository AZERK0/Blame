import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blame",
  description: "The industrial-grade agentic IDE.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/blame-icon-64.png", type: "image/png", sizes: "64x64" },
      { url: "/icons/blame-icon-128.png", type: "image/png", sizes: "128x128" },
      { url: "/icons/blame-icon-256.png", type: "image/png", sizes: "256x256" },
    ],
    apple: [
      { url: "/icons/blame-icon-256.png", type: "image/png", sizes: "256x256" },
    ],
  },
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
