import { LandingRevealStyles } from '@/components/landing-reveal-styles'
import { SiteHeader } from '@/components/site-header'
import { ScrollStory } from './scroll-story'

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] text-white">
      <SiteHeader />
      <ScrollStory />
      <LandingRevealStyles />
    </main>
  )
}
