export type PreviewRecoveryDecision = {
  allowed: boolean;
  retryAfterMs: number;
};

type FailureState = {
  attempts: number;
  configurationFingerprint: string;
  failureFingerprint: string;
  retryAt: number;
};

export class PreviewRecoveryCircuit {
  private readonly delays: number[];
  private readonly failures = new Map<string, FailureState>();

  constructor(delays = [5_000, 30_000, 120_000, 300_000]) {
    this.delays = delays;
  }

  decision(
    key: string,
    configurationFingerprint: string,
    now = Date.now(),
  ): PreviewRecoveryDecision {
    const failure = this.failures.get(key);
    if (
      !failure ||
      failure.configurationFingerprint !== configurationFingerprint
    )
      return { allowed: true, retryAfterMs: 0 };
    const retryAfterMs = Math.max(0, failure.retryAt - now);
    return { allowed: retryAfterMs === 0, retryAfterMs };
  }

  failed(
    key: string,
    configurationFingerprint: string,
    failureFingerprint: string,
    now = Date.now(),
  ) {
    const previous = this.failures.get(key);
    const repeated =
      previous?.configurationFingerprint === configurationFingerprint &&
      previous.failureFingerprint === failureFingerprint;
    const attempts = repeated ? previous.attempts + 1 : 1;
    const delay =
      this.delays[Math.min(attempts - 1, this.delays.length - 1)] ?? 0;
    this.failures.set(key, {
      attempts,
      configurationFingerprint,
      failureFingerprint,
      retryAt: now + delay,
    });
  }

  succeeded(key: string) {
    this.failures.delete(key);
  }

  reset(key: string) {
    this.failures.delete(key);
  }
}
