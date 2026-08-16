const defaultDetailLimit = 1_000;
const truncationMarker = "\n... [Compose output truncated] ...\n";

export function composeCommandFailureDetail(
  stderr: string,
  stdout: string,
  limit = defaultDetailLimit,
) {
  const detail = [stderr, stdout]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
  if (detail.length <= limit) return detail;
  if (limit <= truncationMarker.length) return detail.slice(-limit);
  const available = limit - truncationMarker.length;
  const headLength = Math.floor(available / 3);
  const tailLength = available - headLength;
  return `${detail.slice(0, headLength)}${truncationMarker}${detail.slice(-tailLength)}`;
}
