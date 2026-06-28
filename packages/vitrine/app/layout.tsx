import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Blame',
  description: 'Site vitrine de Blame',
}

type RootLayoutProps = Readonly<{
  children: React.ReactNode
}>

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
