import type { PreviewSessionEvent } from "../domain/preview-session.js";

export interface PreviewEventSink {
  append(event: Omit<PreviewSessionEvent, "cursor" | "sequence">): Promise<PreviewSessionEvent>;
  events(sessionId: string, cursor?: string): AsyncIterable<PreviewSessionEvent>;
}
