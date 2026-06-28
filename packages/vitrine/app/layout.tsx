import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Blame — AI coding, with a merge gate',
  description:
    'Blame turns AI coding into a controlled engineering workflow with user stories, Git worktrees, local previews, reviewable diffs, and validated merges.',
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
