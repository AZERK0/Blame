import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("controlled fault affects one model body after upstream access and retains missing billing evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "light-study-fault-"));
  const logfile = join(directory, "events.jsonl");
  try {
    const source = `
      let upstream = 0;
      globalThis.fetch = async () => { upstream++; return new Response('safe body'); };
      await import(${JSON.stringify(new URL("./light-study-fault.mjs", import.meta.url).href)});
      const call = (body) => fetch('https://offline.invalid', {body: JSON.stringify(body)});
      await (await call({apiKey:'fixture-secret'})).text();
      await (await call({model:'fixture-model', input:[]})).text();
      let interrupted = false;
      try { await (await call({model:'fixture-model', input:[]})).text(); }
      catch (error) { interrupted = error.cause?.code === 'UND_ERR_SOCKET'; }
      const final = await (await call({model:'fixture-model', input:[]})).text();
      process.stdout.write(JSON.stringify({upstream, interrupted, final}));
    `;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", source],
      {
        env: {
          ...process.env,
          BLAME_MODEL_ID: "fixture-model",
          BLAME_STUDY_FAULT_REQUEST: "2",
          BLAME_STUDY_FAULT_LOG: logfile,
        },
        encoding: "utf8",
      },
    );
    assert.deepEqual(JSON.parse(output), {
      upstream: 4,
      interrupted: true,
      final: "safe body",
    });
    const raw = await readFile(logfile, "utf8");
    assert.equal(raw.includes("fixture-secret"), false);
    const events = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((event) => event.injected),
      [false, true, false],
    );
    assert.equal(events[1].providerUsageLost, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
