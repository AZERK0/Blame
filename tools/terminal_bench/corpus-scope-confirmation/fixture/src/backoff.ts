export const RETRY_LABEL = "Retry";

export function retryDelay(attempt: number, baseMs: number): number {
  return baseMs;
}
