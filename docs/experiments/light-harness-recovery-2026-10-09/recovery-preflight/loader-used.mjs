import { appendFileSync } from "node:fs";

// Experimental preload only. Never imported by a production runtime.
const requested = Number(process.env.BLAME_STUDY_FAULT_REQUEST);
const logfile = process.env.BLAME_STUDY_FAULT_LOG;
const expectedModel = process.env.BLAME_MODEL_ID;
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
  // The upstream may already have incurred a charge. Do not invent zero usage.
  await response.body.cancel();
  const error = new TypeError(
    "Controlled provider response interrupted (UND_ERR_SOCKET)",
  );
  error.cause = Object.assign(new Error("other side closed"), {
    code: "UND_ERR_SOCKET",
  });
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.error(error);
      },
    }),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  );
};
