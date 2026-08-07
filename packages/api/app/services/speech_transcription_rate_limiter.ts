type RateLimitWindow = {
  count: number
  inFlight: number
  startedAt: number
}

export type SpeechTranscriptionReservation = {
  retryAfterSeconds: number
  subject: string
}

export default class SpeechTranscriptionRateLimiter {
  private readonly windows = new Map<string, RateLimitWindow>()

  constructor(
    private readonly requestsPerMinute: number,
    private readonly maxConcurrentPerUser: number,
    private readonly now: () => number = Date.now,
    private readonly windowMs = 60_000
  ) {}

  acquire(subject: string): SpeechTranscriptionReservation | null {
    const currentTime = this.now()
    const current = this.windows.get(subject)
    const window =
      !current || currentTime - current.startedAt >= this.windowMs
        ? { count: 0, inFlight: 0, startedAt: currentTime }
        : current

    if (window.count >= this.requestsPerMinute || window.inFlight >= this.maxConcurrentPerUser) {
      return null
    }

    window.count += 1
    window.inFlight += 1
    this.windows.set(subject, window)
    this.prune(currentTime)
    return { retryAfterSeconds: Math.ceil(this.windowMs / 1_000), subject }
  }

  release(reservation: SpeechTranscriptionReservation) {
    const current = this.windows.get(reservation.subject)
    if (!current) return
    current.inFlight = Math.max(0, current.inFlight - 1)
  }

  private prune(currentTime: number) {
    if (this.windows.size < 10_000) return
    for (const [subject, window] of this.windows) {
      if (currentTime - window.startedAt >= this.windowMs && window.inFlight === 0) {
        this.windows.delete(subject)
      }
    }
  }
}
