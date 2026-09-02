export function parseCsvRow(row: string) {
  return row.split(",").map((value) => value.trim());
}
