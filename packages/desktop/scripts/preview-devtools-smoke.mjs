import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app, BrowserWindow, WebContentsView } from "electron";
import { PreviewDevtoolsMcpService } from "../src/main/preview-runtime/preview-devtools-mcp-service.ts";

const artifacts = await mkdtemp(join(tmpdir(), "blame-preview-smoke-"));
const hidden = process.argv.includes("--hidden");
const debuggingPort = await unusedPort();
app.setPath("userData", join(artifacts, "electron"));
app.commandLine.appendSwitch("remote-debugging-port", String(debuggingPort));
app.disableHardwareAcceleration();
const service = new PreviewDevtoolsMcpService();
const fixture = await readFile(
  new URL("./fixtures/preview-devtools.html", import.meta.url),
);
const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(fixture);
});
await listen(server);
const currentUrl = `http://127.0.0.1:${server.address().port}/`;
const input = {
  browserUrl: `http://127.0.0.1:${debuggingPort}`,
  currentUrl,
  scope: "smoke",
  worktree: artifacts,
};
const timeout = setTimeout(() => {
  console.error("Preview smoke timed out");
  app.exit(1);
}, 90_000);
let owner;
let view;
const results = [];

void app.whenReady().then(runSmoke);

async function runSmoke() {
  owner = new BrowserWindow({ show: true, width: 1200, height: 900 });
  try {
    for (let iteration = 0; iteration < 3; iteration += 1)
      await inspectRecreatedPage(iteration);
    console.log(
      JSON.stringify({
        status: "passed",
        browser: process.versions.chrome,
        hidden,
        artifacts,
        runs: results,
      }),
    );
  } catch (error) {
    process.exitCode = 1;
    console.error(error);
  } finally {
    clearTimeout(timeout);
    await service.dispose();
    owner.destroy();
    server.close();
    app.exit(process.exitCode ?? 0);
  }
}

async function inspectRecreatedPage(iteration) {
  const started = Date.now();
  await recreatePage();
  const pageIdentity = `browser-${iteration}`;
  const call = (toolName, args) =>
    service.call({ ...input, pageIdentity, toolName, arguments: args });
  await service.prepare({ ...input, pageIdentity });
  assert.match(
    textContent(await call("take_snapshot")),
    /Preview inspection smoke/,
  );
  const animationMs = await verifyInteractions(call);
  const screenshotBytes = await saveScreenshot(call, iteration);
  assert.equal(view.webContents.getBackgroundThrottling(), true);
  assert.equal(view.getVisible(), !hidden);
  results.push({
    iteration,
    durationMs: Date.now() - started,
    animationMs,
    screenshotBytes,
  });
}

async function recreatePage() {
  if (view) {
    owner.contentView.removeChildView(view);
    view.webContents.close();
  }
  view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  owner.contentView.addChildView(view);
  view.setBounds({ width: 1100, height: 800, x: 0, y: 0 });
  view.setVisible(!hidden);
  await view.webContents.loadURL(currentUrl);
}

async function saveScreenshot(call, iteration) {
  const screenshot = await call("take_screenshot", { format: "png" });
  const image = screenshot.content.find((block) => block.type === "image");
  assert.ok(image?.data, textContent(screenshot));
  await writeFile(
    join(artifacts, `preview-${iteration}.png`),
    Buffer.from(image.data, "base64"),
  );
  return Buffer.from(image.data, "base64").length;
}

async function verifyInteractions(call) {
  view.setBounds({ width: 941, height: 620, x: 0, y: 0 });
  const snapshot = textContent(await call("take_snapshot"));
  const advance = snapshot.match(/uid=(\S+) button "Advance project"/u)?.[1];
  const drop = snapshot.match(/uid=(\S+) button "Drop project here"/u)?.[1];
  assert.ok(advance && drop, snapshot);
  assertToolSuccess(await call("click", { uid: advance }));
  assertToolSuccess(await call("press_key", { key: "ArrowRight" }));
  assertToolSuccess(await call("drag", { from_uid: advance, to_uid: drop }));
  await verifyWheelAndState();
  return verifyAnimation(call);
}

async function verifyWheelAndState() {
  view.webContents.sendInputEvent({
    type: "mouseWheel",
    x: 200,
    y: 250,
    deltaX: 100,
    deltaY: 0,
    modifiers: ["shift"],
    canScroll: true,
  });
  const state = await view.webContents.executeJavaScript(
    `new Promise(resolve => setTimeout(() => resolve({ ...window.inspection, width: innerWidth, height: innerHeight }), 100))`,
  );
  assert.equal(state.width, 941);
  assert.equal(state.height, 620);
  assert.ok(
    state.clicks >= 1 &&
      state.keys >= 1 &&
      state.drops >= 1 &&
      state.wheels >= 1,
    JSON.stringify(state),
  );
}

async function verifyAnimation(call) {
  const animation = await call("evaluate_script", {
    waitForStableDom: false,
    function:
      "async () => { const start = performance.now(); for(let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); return { elapsed: performance.now() - start }; }",
  });
  assertToolSuccess(animation);
  const elapsed = Number(
    textContent(animation).match(/"elapsed"\s*:\s*([\d.]+)/u)?.[1],
  );
  assert.ok(elapsed < 1000, textContent(animation));
  return elapsed;
}

function textContent(result) {
  return (
    result.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n") ?? ""
  );
}

function assertToolSuccess(result) {
  assert.notEqual(result.isError, true, textContent(result));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

async function unusedPort() {
  const reservation = createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  return port;
}
