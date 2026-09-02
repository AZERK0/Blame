const processedWebhookIds = new Set<string>();

export async function processWebhook(
  eventId: string,
  handle: () => Promise<void>,
) {
  if (processedWebhookIds.has(eventId)) return false;
  processedWebhookIds.add(eventId);
  await handle();
  return true;
}

export function clearProcessedWebhooks() {
  processedWebhookIds.clear();
}
