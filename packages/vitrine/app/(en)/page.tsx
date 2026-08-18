import { LandingRevealStyles } from '@/components/landing-reveal-styles'
import { JsonLd } from '@/components/json-ld'
import { SiteHeader } from '@/components/site-header'
import { ProductStory } from '@/app/product-story'
import { LandingHero } from '@/app/scroll-story'
import { createIndexablePageMetadata } from '@/lib/seo'
import { homepageStructuredData } from '@/lib/structured-data'

export const metadata = createIndexablePageMetadata({
  title: 'Blame — Agentic IDE for Controlled AI Coding Workflows',
  description:
    'Run AI coding agents in isolated Git worktrees, preview every change, review diffs, and merge only when the work is ready.',
  canonicalPath: '/',
})

export default function Home() {
  return (
    <>
      <JsonLd id="homepage-structured-data" data={homepageStructuredData} />
      <main className="marketing-page min-h-screen overflow-x-hidden bg-[#050505] text-white">
        <SiteHeader />
        <LandingHero />
        <ProductStory />
        <LandingRevealStyles />
      </main>
    </>
  )
}
