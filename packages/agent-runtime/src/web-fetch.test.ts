import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createAgentRuntime, createBuiltinTools, createDefaultExecutors, type AgentTool } from "@cline/sdk";
import { createTextWebFetchExecutor, describeTextWebFetch } from "./web-fetch.js";

const webFetch = createTextWebFetchExecutor();
type WebContext = Parameters<typeof webFetch>[2];
const context = {} as WebContext;

test("the SDK sends the accurate web description without replacing or mutating tools", async () => {
  const tools = createBuiltinTools() as AgentTool[];
  const source = tools.find((tool) => tool.name === "fetch_web_content")!;
  const original = JSON.stringify(source);
  const execute = source.execute;
  let received: AgentTool[] = [];
  const runtime = createAgentRuntime({
    tools,
    hooks: { beforeModel: describeTextWebFetch },
    model: { async *stream(request: { tools: AgentTool[] }) {
      received = request.tools;
      yield { type: "text-delta", text: "done" };
      yield { type: "finish", reason: "stop" };
    } },
  });
  const result = await runtime.run("inspect");
  const projected = received.find((tool) => tool.name === "fetch_web_content")!;
  assert.equal(result.status, "completed");
  assert.match(projected.description, /for the agent to analyze/u);
  assert.match(projected.description, /prompt indicates the focus/u);
  assert.deepEqual(received.map((tool) => tool.name), tools.map((tool) => tool.name));
  assert.equal(projected.inputSchema, source.inputSchema);
  assert.equal(JSON.stringify(source), original);
  assert.equal(source.execute, execute);
});

async function withServer(handler: RequestListener, run: (url: string) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/resource.zip`); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("text, HTML, JSON, XML and CSV retain the SDK output without URL suffix inference", async () => {
  const samples = [
    ["text/plain", "élève 🐱\nsecond\tcolumn"],
    ["text/html", "<style>hidden</style><h1>A &amp; B</h1><script>hidden</script><p>Visible</p>"],
    ["application/json", '{"value":"élève","items":[1,2]}'],
    ["application/xml", '<root key="value">élève 🐱</root>'],
    ["text/csv", "name,value\nélève,3\n"],
    ["application/octet-stream", "export const greeting = 'Bonjour 🐱';\n"],
    ["", "source without a media type\n"],
  ];
  for (const [mediaType, source] of samples)
    await withServer((_request, response) => {
      if (mediaType) response.setHeader("content-type", mediaType);
      response.end(source);
    }, async (url) => {
      assert.equal(await webFetch(url, "inspect", context),
        await createDefaultExecutors().webFetch!(url, "inspect", context));
    });
});

test("declared binary resources return bounded metadata without waiting for a body", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/zip", "content-length": "900000000" });
    response.flushHeaders();
  }, async (url) => {
    const result = await createTextWebFetchExecutor({ timeoutMs: 1000 })(url, "inspect", context);
    assert.match(result, /Binary response body omitted/u);
    assert.match(result, /Content-Length: 900000000/u);
    assert.match(result, /shell command/u);
    assert.ok(Buffer.byteLength(result) < 1000);
  });
});

test("archives with a missing or misleading text media type never reach textual context", async () => {
  const samples = [gzipSync("payload".repeat(10_000)), Buffer.from("504b03040000000000", "hex")];
  for (const body of samples)
    for (const mediaType of ["text/plain", "application/octet-stream", ""])
      await withServer((_request, response) => {
        if (mediaType) response.setHeader("content-type", mediaType);
        response.end(body);
      }, async (url) => {
        const result = await webFetch(url, "inspect", context);
        assert.match(result, /Binary response body omitted/u);
        assert.ok(Buffer.byteLength(result) < 1000);
      });
});

test("decoding preserves multibyte UTF-8 across response chunks", async () => {
  const bytes = Buffer.from("élève 🐱");
  await withServer((_request, response) => {
    response.write(bytes.subarray(0, 1));
    setImmediate(() => {
      response.write(bytes.subarray(1, 8));
      setImmediate(() => response.end(bytes.subarray(8)));
    });
  }, async (url) => {
    assert.match(await webFetch(url, "inspect", context), /élève 🐱/u);
  });
});

test("UTF-16 BOM and declared text charset are decoded before binary control detection", async () => {
  const samples = [
    { type: "text/plain", bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("élève 🐱", "utf16le")]), expected: "élève 🐱" },
    { type: "text/plain; charset=iso-8859-1", bytes: Buffer.from("élève", "latin1"), expected: "élève" },
  ];
  for (const sample of samples)
    await withServer((_request, response) => {
      response.setHeader("content-type", sample.type);
      response.write(sample.bytes.subarray(0, 1));
      setImmediate(() => response.end(sample.bytes.subarray(1)));
    }, async (url) => {
      assert.ok((await webFetch(url, "inspect", context)).includes(sample.expected));
    });
});

test("legacy text without a charset retains the SDK's tolerant decoding", async () => {
  await withServer((_request, response) => {
    response.setHeader("content-type", "text/plain");
    response.end(Buffer.from("café", "latin1"));
  }, async (url) => {
    assert.equal(await webFetch(url, "inspect", context), await createDefaultExecutors().webFetch!(url, "inspect", context));
  });
});

test("download limit counts bytes without Content-Length and output keeps the SDK text limit", async () => {
  await withServer((_request, response) => {
    response.write("é".repeat(26_000));
    response.end();
  }, async (url) => {
    await assert.rejects(createTextWebFetchExecutor({ maxResponseBytes: 100 })(url, "inspect", context), /exceeded 100 bytes/u);
    assert.equal(await webFetch(url, "inspect", context), await createDefaultExecutors().webFetch!(url, "inspect", context));
  });
  await withServer((_request, response) => response.end("a".repeat(50_001)), async (url) => {
    assert.equal(await webFetch(url, "inspect", context), await createDefaultExecutors().webFetch!(url, "inspect", context));
  });
});

test("HTTP and transport errors remain errors and unsupported protocols never fetch", async () => {
  await withServer((_request, response) => response.writeHead(404, "Not Found").end(), async (url) => {
    await assert.rejects(webFetch(url, "inspect", context), /HTTP 404: Not Found/u);
  });
  await assert.rejects(webFetch("file:///tmp/archive.zip", "inspect", context), /Invalid protocol/u);
  await assert.rejects(webFetch("not a URL", "inspect", context), /Invalid URL/u);
});

test("already aborted requests retain the caller's reason", async () => {
  const reason = new Error("cancelled by user");
  const signal = AbortSignal.abort(reason);
  await assert.rejects(webFetch("http://127.0.0.1:1", "inspect", { signal } as WebContext), reason);
});

test("timeout remains active while reading a response body", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.write("waiting");
  }, async (url) => {
    await assert.rejects(createTextWebFetchExecutor({ timeoutMs: 50 })(url, "inspect", context), /Request timed out after 50ms/u);
  });
});

test("cancellation remains active after response headers", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel body");
  await withServer((_request, response) => {
    response.write("waiting");
    setImmediate(() => controller.abort(reason));
  }, async (url) => {
    await assert.rejects(webFetch(url, "inspect", { signal: controller.signal } as WebContext), reason);
  });
});

test("the native fetch_web_content tool invokes the supplied executor and preserves per-URL errors", async () => {
  const tool = createBuiltinTools({ executors: { webFetch } }).find((entry: AgentTool) => entry.name === "fetch_web_content")!;
  await withServer((request, response) => {
    if (request.url === "/missing") response.writeHead(404, "Not Found").end();
    else response.writeHead(200, { "content-type": "application/zip" }).end("binary");
  }, async (url) => {
    const result = await tool.execute({ requests: [{ url, prompt: "inspect" }, { url: new URL("/missing", url).href, prompt: "inspect" }] }, context);
    const serialized = JSON.stringify(result);
    assert.match(serialized, /Binary response body omitted/u);
    assert.match(serialized, /HTTP 404/u);
    assert.doesNotMatch(serialized, /--- Content ---/u);
  });
});
