type RateLimitWindow = {
  count: number
  startedAt: number
}

export default class TelemetryRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>()

  constructor(
    private readonly limit: number,
    private readonly now: () => number = Date.now,
    private readonly windowMs = 60_000
  ) {}

  allow(subject: string) {
    const currentTime = this.now()
    const current = this.windows.get(subject)
    if (!current || currentTime - current.startedAt >= this.windowMs) {
      this.windows.set(subject, { count: 1, startedAt: currentTime })
      this.prune(currentTime)
      return true
    }
    current.count += 1
    return current.count <= this.limit
  }

  private prune(currentTime: number) {
    if (this.windows.size < 10_000) return
    for (const [subject, window] of this.windows) {
      if (currentTime - window.startedAt >= this.windowMs) this.windows.delete(subject)
    }
  }
}
