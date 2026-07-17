import { HeroScene } from "./hero-scene";

export function FinalCtaScene() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 isolate opacity-70 grayscale contrast-125"
    >
      <HeroScene />
    </div>
  );
}
