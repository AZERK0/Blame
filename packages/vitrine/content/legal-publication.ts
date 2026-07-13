export function legalDocumentReadyForPublication(
  approvedForPublication: boolean,
  content: unknown,
) {
  return approvedForPublication && !JSON.stringify(content).includes("[[");
}
