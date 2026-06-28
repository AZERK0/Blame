import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Blame — Agentic IDE',
  description:
    'Blame transforme le code IA en workflow maîtrisé avec backlog, worktrees, previews, diffs et merge contrôlé.',
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
