import "./styles.css";

const portfolioTitle = "Portfolio";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      h1: { children?: unknown; className?: string };
      main: { children?: unknown };
    }
  }
}

export function PortfolioPage() {
  return (
    <main>
      <h1 className="portfolio-title">{portfolioTitle}</h1>
    </main>
  );
}
