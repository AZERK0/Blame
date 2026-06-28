export default function Home() {
  const workflowSteps = [
    {
      label: 'Story',
      title: 'Checkout revamp',
      detail: 'Acceptance criteria locked',
      meta: 'backlog/blame-142',
    },
    {
      label: 'Worktree',
      title: 'feature/checkout-flow',
      detail: 'Deps installed · env synced',
      meta: 'isolated workspace',
    },
    {
      label: 'Preview',
      title: 'localhost:5173',
      detail: 'Running in the IDE preview',
      meta: 'port assigned',
    },
    {
      label: 'Diff',
      title: '+24 / -6 lines',
      detail: 'Reviewable changes only',
      meta: 'tests green',
    },
    {
      label: 'Merge gate',
      title: 'Validated by you',
      detail: 'No hidden branch drift',
      meta: 'ready to merge',
    },
  ]

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#hero" aria-label="Blame home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>Blame</span>
        </a>

        <nav className="site-nav" aria-label="Navigation principale">
          <a href="#workflow">Workflow</a>
          <a href="#worktrees">Worktrees</a>
          <a href="#review">Review</a>
        </nav>

        <a className="header-cta" href="mailto:hello@blame.dev">
          Get early access
        </a>
      </header>

      <main className="page">
        <section className="hero" id="hero" aria-labelledby="hero-title">
          <div className="hero-content">
            <p className="eyebrow">
              <span className="status-dot" aria-hidden="true" />
              Agentic IDE for controlled AI coding
            </p>

            <h1 id="hero-title">AI coding, with a merge gate.</h1>

            <p className="summary">
              Blame turns prompts into traceable user stories, isolated Git
              worktrees, localhost previews, reviewable diffs, and merges you
              explicitly validate.
            </p>

            <div className="hero-actions" aria-label="Actions principales">
              <a className="primary-action" href="mailto:hello@blame.dev">
                Get early access
              </a>
              <a className="secondary-action" href="#workflow">
                Explore the workflow
              </a>
            </div>

            <dl
              className="proof-list"
              id="workflow"
              aria-label="Product highlights"
            >
              <div>
                <dt>Backlog</dt>
                <dd>Every agent run starts from a real story.</dd>
              </div>
              <div id="worktrees">
                <dt>Worktree</dt>
                <dd>One isolated environment per feature.</dd>
              </div>
              <div id="review">
                <dt>Review</dt>
                <dd>Preview, diff, then validated merge.</dd>
              </div>
            </dl>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="orbital-grid" />
            <div className="workflow-stage">
              <div className="stage-header">
                <span className="stage-light" />
                <span className="stage-light" />
                <span className="stage-light" />
                <span className="stage-path">~/blame/worktrees/story-142</span>
              </div>

              <div className="branch-line" />

              {workflowSteps.map((step, index) => (
                <article
                  className={`workflow-card card-${index + 1}`}
                  key={step.label}
                >
                  <div className="card-topline">
                    <span>{step.label}</span>
                    <span>{step.meta}</span>
                  </div>
                  <h2>{step.title}</h2>
                  <p>{step.detail}</p>
                  {step.label === 'Diff' ? (
                    <div className="diff-lines">
                      <span className="added">+ connect preview state</span>
                      <span className="removed">- manual localhost setup</span>
                    </div>
                  ) : null}
                </article>
              ))}

              <div className="agent-console">
                <span className="console-label">agent activity</span>
                <span>Plan accepted</span>
                <span>Tests passed</span>
                <span>Awaiting human merge</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
