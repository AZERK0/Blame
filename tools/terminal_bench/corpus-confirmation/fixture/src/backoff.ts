export function retryDelay(attempt: number): number {
  return 200 * (attempt + 1);
}
export function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}
