export function calculateServiceFee(totalCents: number) {
  if (totalCents < 50_000) return 0;
  return Math.round(totalCents * 0.02);
}

export function describeServiceFee(totalCents: number) {
  return calculateServiceFee(totalCents) > 0 ? "legacy" : "none";
}
