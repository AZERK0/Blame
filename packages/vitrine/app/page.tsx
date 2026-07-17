import { LandingRevealStyles } from '@/components/landing-reveal-styles'
import { SiteHeader } from '@/components/site-header'
import { ProductStory } from './product-story'
import { LandingHero } from './scroll-story'

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] text-white">
      <SiteHeader />
      <LandingHero />
      <ProductStory />
      <LandingRevealStyles />
    </main>
  )
}
