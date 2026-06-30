export function LandingRevealStyles() {
  return (
    <style>{`
      .hero-stage canvas {
        opacity: 0;
        transform: scale(1.015);
        animation: sceneCanvasReveal 920ms cubic-bezier(0.2, 0.8, 0.2, 1) 160ms forwards;
      }

      .landing-reveal {
        opacity: 0;
        transform: translate3d(0, 18px, 0);
        animation: landingReveal 760ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
      }

      .landing-reveal-header {
        animation-delay: 80ms;
      }

      .landing-reveal-eyebrow {
        animation-delay: 150ms;
      }

      .landing-reveal-title {
        animation-delay: 220ms;
      }

      .landing-reveal-copy {
        animation-delay: 330ms;
      }

      .landing-reveal-actions {
        animation-delay: 430ms;
      }

      .landing-reveal-mockup {
        animation-delay: 540ms;
        transform: translate3d(0, 24px, 0) scale(0.985);
      }

      .scene-warmup {
        animation: sceneWarmupExit 560ms cubic-bezier(0.3, 0, 0, 1) 820ms forwards;
      }

      .scene-warmup-scan {
        animation: warmupScan 940ms cubic-bezier(0.7, 0, 0.2, 1) 120ms forwards;
      }

      @keyframes sceneCanvasReveal {
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      @keyframes landingReveal {
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }

      @keyframes sceneWarmupExit {
        to {
          opacity: 0;
          transform: scale(1.015);
          visibility: hidden;
        }
      }

      @keyframes warmupScan {
        from {
          transform: translateX(-115%);
        }
        to {
          transform: translateX(115%);
        }
      }
    `}</style>
  )
}