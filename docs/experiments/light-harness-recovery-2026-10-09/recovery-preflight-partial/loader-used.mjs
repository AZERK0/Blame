import { appendFileSync } from "node:fs";

// Experimental preload only. Never imported by a production runtime.
const requested = Number(process.env.BLAME_STUDY_FAULT_REQUEST);
const logfile = process.env.BLAME_STUDY_FAULT_LOG;
const expectedModel = process.env.BLAME_MODEL_ID;
const mode = process.env.BLAME_STUDY_FAULT_MODE ?? "before-body";
if (!Number.isInteger(requested) || requested < 1 || !logfile || !expectedModel)
  throw new Error("Incomplete controlled transport-fault configuration");
const originalFetch = globalThis.fetch;
let count = 0;
globalThis.fetch = async (input, init) => {
  let body;
  try {
    body = JSON.parse(typeof init?.body === "string" ? init.body : "null");
  } catch {
    /* not a model request */
  }
  const model = body?.model === expectedModel;
  const index = model ? ++count : null;
  const response = await originalFetch(input, init);
  if (!model) return response;
  const injected = index === requested && response.ok && response.body !== null;
  appendFileSync(
    logfile,
    JSON.stringify({
      at: new Date().toISOString(),
      request: index,
      status: response.status,
      injected,
      providerUsageLost: injected,
    }) + "\n",
  );
  if (!injected) return response;
  if (mode === "partial") {
    const reader = response.body.getReader();
    let delivered = false;
    return new Response(
      new ReadableStream(
        {
          async pull(controller) {
            if (delivered) {
              controller.error(interruption());
              return;
            }
            let bytes = new Uint8Array(),
              text = "";
            while (bytes.length < 2_097_152) {
              const chunk = await reader.read();
              if (chunk.done) break;
              const next = new Uint8Array(bytes.length + chunk.value.length);
              next.set(bytes);
              next.set(chunk.value, bytes.length);
              bytes = next;
              text = new TextDecoder().decode(bytes);
              const delta =
                /(?:response\.(?:output_text|function_call_arguments|reasoning_summary_text)\.delta)[^\n]*\n/u.exec(
                  text,
                );
              if (delta) {
                const end = text.indexOf("\n\n", delta.index);
                if (end >= 0) {
                  bytes = new TextEncoder().encode(text.slice(0, end + 2));
                  break;
                }
              }
              if (
                !response.headers
                  .get("content-type")
                  ?.includes("text/event-stream")
              ) {
                bytes = bytes.slice(0, Math.min(64, bytes.length));
                break;
              }
            }
            await reader.cancel();
            delivered = true;
            appendFileSync(
              logfile,
              JSON.stringify({
                at: new Date().toISOString(),
                request: index,
                injected: true,
                deliveredBytes: bytes.length,
                contentType: response.headers.get("content-type"),
                providerUsageLost: true,
              }) + "\n",
            );
            if (bytes.length) controller.enqueue(bytes);
            else controller.error(interruption());
          },
          async cancel(reason) {
            await reader.cancel(reason);
          },
        },
        { highWaterMark: 0 },
      ),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  }
  // The upstream may already have incurred a charge. Do not invent zero usage.
  await response.body.cancel();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(interruption());
      },
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
};

function interruption() {
  const error = new TypeError(
    "Controlled provider response interrupted (UND_ERR_SOCKET)",
  );
  error.cause = Object.assign(new Error("other side closed"), {
    code: "UND_ERR_SOCKET",
  });
  return error;
}
