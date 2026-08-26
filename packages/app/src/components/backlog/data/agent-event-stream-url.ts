export function resumableEventStreamUrl(
  eventStreamUrl: string,
  lastSequenceNumber: number
) {
  if (!Number.isSafeInteger(lastSequenceNumber) || lastSequenceNumber <= 0) {
    return eventStreamUrl
  }
  const url = new URL(eventStreamUrl)
  url.searchParams.set("lastEventId", String(lastSequenceNumber))
  return url.toString()
}
