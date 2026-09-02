export function formatPrice(amount: number) {
  const rounded = Math.round(amount * 100) / 100;
  return `${rounded.toFixed(2)} EUR`;
}

export function discountedPrice(amount: number, percent: number) {
  return Math.round(amount * (1 - percent / 100) * 100) / 100;
}
