import { rootMetadata } from "@/app/root-document";
import "@/app/globals.css";

export const metadata = rootMetadata;

export default function AuthRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
