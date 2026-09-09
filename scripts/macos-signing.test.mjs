import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

async function signingModule(commands) {
  const desktopRequire = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
  const builderRequire = createRequire(desktopRequire.resolve("electron-builder"));
  const file = join(dirname(builderRequire.resolve("app-builder-lib/package.json")), "out/codeSign/macCodeSign.js");
  const originalRequire = createRequire(file);
  const exports = {};
  const exec = async (command, args) => { commands.push(args); return ""; };
  const require = (name) => {
    if (name === "builder-util") return { exec, unlinkIfExists: async () => {} };
    if (name === "./codesign") return { importCertificate: async value => value };
    return originalRequire(name);
  };
  runInNewContext(await readFile(file, "utf8"), { exports, require, process: { env: { TRAVIS: "true" } }, __dirname: dirname(file) });
  return exports;
}

test("signing unlocks the keychain with its own password and imports certificates with theirs", async () => {
  const commands = [];
  const { createKeychain } = await signingModule(commands);
  await createKeychain({ tmpDir: {}, currentDir: "/fixture", cscLink: "application.p12", cscKeyPassword: "application-password",
    cscILink: "installer.p12", cscIKeyPassword: "installer-password" });
  const keychainPassword = commands.find(args => args[0] === "create-keychain")[2];
  const partitionCommands = commands.filter(args => args[0] === "set-key-partition-list");
  assert.equal(partitionCommands.length, 2);
  for (const args of partitionCommands) assert.equal(args[args.indexOf("-k") + 1], keychainPassword);
  const importPasswords = commands.filter(args => args[0] === "import").map(args => args[args.indexOf("-P") + 1]);
  assert.deepEqual(importPasswords, ["application-password", "installer-password"]);
});
