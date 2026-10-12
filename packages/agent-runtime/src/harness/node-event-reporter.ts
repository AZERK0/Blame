// Loaded by the actual Node runner. stdout/diagnostic events cannot become summaries.
export default async function* nodeEventReporter(events: AsyncIterable<{
  type: string; data: { file?: string; counts?: unknown };
}>) {
  yield JSON.stringify({ format: "blame-node-events-v1", runner: {
    version: process.version, executable: process.execPath,
    platform: process.platform, arch: process.arch, timezone: process.env.TZ ?? null,
  } }) + "\n";
  for await (const event of events) {
    if (event.type === "test:summary")
      yield JSON.stringify({ type: "summary", ...(event.data.file ? { file: event.data.file } : {}),
        counts: event.data.counts }) + "\n";
  }
  yield '{"type":"complete"}\n';
}
