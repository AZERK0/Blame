import { ArrowRight, Play } from 'lucide-react'
import { HeroLattice } from './hero-lattice'

const workflowSteps = ['Backlog', 'Worktree', 'Preview', 'Diff', 'Merge'] as const

export default function Home() {
  return (
    <main className="page">
      <header className="site-header" aria-label="Navigation principale">
        <a className="brand" href="#top" aria-label="Blame accueil">
          <span className="brand-mark">B</span>
          <span>Blame</span>
        </a>

        <nav className="site-nav" aria-label="Sections de la vitrine">
          <a href="#workflow">Workflow</a>
          <a href="#preview">Preview</a>
          <a href="#diff">Diffs</a>
          <a href="#merge">Merge</a>
        </nav>

        <a className="header-cta" href="#start">
          Rejoindre la bêta
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Agentic IDE · du backlog au merge</p>
          <h1>Transforme le code IA en workflow maîtrisé.</h1>
          <p className="summary">
            Blame donne aux agents un backlog, des worktrees isolés, des previews
            locales, des diffs lisibles et des portes de merge — pour accélérer
            sans perdre le contrôle.
          </p>

          <div className="hero-actions" id="start" aria-label="Actions principales">
            <a className="primary-action" href="#start">
              Démarrer un workspace
              <ArrowRight aria-hidden="true" size={18} strokeWidth={2.4} />
            </a>
            <a className="secondary-action" href="#workflow">
              <Play aria-hidden="true" size={16} fill="currentColor" strokeWidth={2.2} />
              Voir le workflow
            </a>
          </div>

          <div className="workflow-strip" id="workflow" aria-label="Flux de travail Blame">
            {workflowSteps.map((step, index) => (
              <div className="workflow-step" id={step.toLowerCase()} key={step}>
                <span className="workflow-dot" aria-hidden="true" />
                <span>{step}</span>
                {index < workflowSteps.length - 1 ? (
                  <span className="workflow-link" aria-hidden="true" />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="hero-visual" aria-label="Visualisation abstraite du flux de revue">
          <HeroLattice />
          <div className="visual-caption">
            <span className="status-light" aria-hidden="true" />
            Preview locale liée à la story-branch
          </div>
        </div>
      </section>
    </main>
  )
}
