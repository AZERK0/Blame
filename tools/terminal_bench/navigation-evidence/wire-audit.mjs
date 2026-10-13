// Research-only preload: observe public request contracts without changing them.
import { appendFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const destination = process.env.BLAME_STUDY_WIRE_AUDIT;
if (!destination) throw Error("Wire audit destination must be explicit");
const original = globalThis.fetch;
const sha = text => createHash("sha256").update(text).digest("hex");
const normalize = value => typeof value === "string" && process.env.BLAME_STUDY_WORKSPACE
  ? value.replaceAll(process.env.BLAME_STUDY_WORKSPACE, "<WORKSPACE>") : value;
globalThis.fetch = async function auditedFetch(input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const raw = typeof init?.body === "string" ? init.body
    : input instanceof Request && input.method === "POST" ? await input.clone().text() : undefined;
  let body; try { if (raw) body = JSON.parse(raw); } catch {}
  if (body && typeof body.model === "string" && (body.input || body.messages)) {
    // No headers, URL query, credentials or conversation messages are archived.
    const tools = body.tools ?? null;
    const prompt = body.instructions ?? (body.messages ?? body.input ?? [])
      .filter(message => ["system", "developer"].includes(message.role));
    const toolsText = JSON.stringify(tools), promptText = JSON.stringify(prompt);
    for (const text of [toolsText, promptText])
      if (process.env.BLAME_API_TOKEN && text.includes(process.env.BLAME_API_TOKEN))
        throw Error("Configured credential unexpectedly appears in a public request contract");
    const toolSha = sha(toolsText), promptSha = sha(promptText);
    const normalized = JSON.stringify({ tools, prompt }, (_key, value) => normalize(value));
    await writeFile(join(dirname(destination), "schema-" + toolSha + ".json"), toolsText + "\n", { flag: "wx" })
      .catch(error => { if (error.code !== "EEXIST") throw error; });
    await writeFile(join(dirname(destination), "prompt-" + promptSha + ".json"), promptText + "\n", { flag: "wx" })
      .catch(error => { if (error.code !== "EEXIST") throw error; });
    await appendFile(destination, JSON.stringify({ time: new Date().toISOString(), endpoint: url.origin + url.pathname,
      model: body.model, reasoning: body.reasoning ?? null,
      maximumOutputTokens: body.max_output_tokens ?? body.max_tokens ?? null,
      toolsSha256: toolSha, promptSha256: promptSha, normalizedContractSha256: sha(normalized),
      requestBodySha256: sha(raw), toolCount: Array.isArray(tools) ? tools.length : null }) + "\n");
  }
  return original(input, init);
};
