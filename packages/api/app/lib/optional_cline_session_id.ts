export function optionalClineSessionId(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
