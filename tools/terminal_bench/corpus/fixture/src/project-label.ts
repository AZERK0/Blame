export const labelSeparator = ": ";

export function formatProjectLabel(name: string) {
  return `Project${labelSeparator}${name}`;
}
