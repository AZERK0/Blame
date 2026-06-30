export function SceneWarmup() {
  return (
    <div
      aria-hidden="true"
      className="scene-warmup pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#050712]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(179,172,243,0.22),transparent_28%),linear-gradient(180deg,rgba(5,7,18,0.7),rgba(5,7,18,0.92))]" />
      <div className="absolute inset-x-0 top-[42%] h-px overflow-hidden bg-white/[0.08]">
        <div className="scene-warmup-scan h-full w-2/3 bg-gradient-to-r from-transparent via-[#d7d2ff]/70 to-transparent shadow-[0_0_26px_rgba(179,172,243,0.65)]" />
      </div>
    </div>
  )
}