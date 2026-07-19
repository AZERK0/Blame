import { RootDocument, rootMetadata } from "@/app/root-document";

export const metadata = rootMetadata;

export default function FrenchRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <RootDocument language="fr">{children}</RootDocument>;
}
