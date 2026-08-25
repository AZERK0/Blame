type UpstreamHealth = {
  consecutiveFailures: number
  firstFailureAt?: string
  lastFailureAt?: string
  nextProbeAt?: string
  suppressedFailures: number
}

export default class TelemetryUpstreamHealthService {
  private state: UpstreamHealth = initialHealth()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  canAttempt() {
    return !this.state.nextProbeAt || this.now() >= Date.parse(this.state.nextProbeAt)
  }

  retryAfterSeconds() {
    if (!this.state.nextProbeAt) return 0
    return Math.max(1, Math.ceil((Date.parse(this.state.nextProbeAt) - this.now()) / 1_000))
  }

  recordFailure() {
    const current = new Date(this.now())
    const failures = this.state.consecutiveFailures + 1
    const delaySeconds = failureDelaySeconds(failures)
    const shouldLog = failures === 1 || this.canAttempt()
    this.state = {
      consecutiveFailures: failures,
      firstFailureAt: this.state.firstFailureAt ?? current.toISOString(),
      lastFailureAt: current.toISOString(),
      nextProbeAt: new Date(current.getTime() + delaySeconds * 1_000).toISOString(),
      suppressedFailures: shouldLog ? 0 : this.state.suppressedFailures + 1,
    }
    return { shouldLog, ...this.snapshot() }
  }

  recordSuccess() {
    this.state = initialHealth()
  }

  snapshot() {
    return {
      available: this.state.consecutiveFailures === 0,
      circuit: this.canAttempt() ? 'closed' : 'open',
      retryAfterSeconds: this.retryAfterSeconds(),
      ...this.state,
    }
  }
}

function failureDelaySeconds(failures: number) {
  return [5, 30, 120, 300][Math.min(failures - 1, 3)]!
}

function initialHealth(): UpstreamHealth {
  return { consecutiveFailures: 0, suppressedFailures: 0 }
}
