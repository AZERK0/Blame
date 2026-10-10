export function allocateCents(total: number, recipients: number): number[] {
  return Array(recipients).fill(Math.round(total / recipients));
}
