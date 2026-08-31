export function boundedDiagnostic(value: string, fallback = "") {
  if (!value) return fallback;
  const maximum = 16_000;
  if (value.length <= maximum) return value;
  const half = Math.floor((maximum - 32) / 2);
  return `${value.slice(0, half)}\n… diagnostic truncated …\n${value.slice(-half)}`;
}
