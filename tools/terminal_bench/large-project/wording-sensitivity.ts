// Exploratory audit of the original "at least eight" request. No source repair.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const workspace = resolve(process.argv[2]);
const { format } = await import(pathToFileURL(resolve(workspace, "src/format/index.ts")).href);
const { lightFormat } = await import(pathToFileURL(resolve(workspace, "src/lightFormat/index.ts")).href);
const checks: { name: string; passed: boolean; error?: string }[] = [];
for (const [hour, minute, second, millisecond] of [
  [0, 0, 0, 0], [0, 0, 0, 7], [0, 0, 1, 1], [1, 2, 3, 4], [12, 34, 56, 789], [23, 59, 59, 999],
]) {
  for (const token of ["J", "JJ", "JJJ", "JJJJJJJJJJ"]) {
    const name = [hour, minute, second, millisecond, token].join(":");
    try {
      const date = new Date(2021, 5, 9, hour, minute, second, millisecond);
      const before = date.getTime();
      const value = ((hour * 60 + minute) * 60 + second) * 1000 + millisecond;
      const output = format(date, token);
      if (token === "J") assert.equal(output, String(value));
      else {
        assert.match(output, /^\d{8,}$/u);
        assert.equal(Number(output), value);
        assert.equal(output, String(value).padStart(output.length, "0"));
      }
      assert.equal(lightFormat(date, token), output);
      assert.equal(format(date, "'J JJ' " + token), "J JJ " + output);
      assert.equal(lightFormat(date, "'J JJ' " + token), "J JJ " + output);
      assert.equal(date.getTime(), before);
      checks.push({ name, passed: true });
    } catch (error) { checks.push({ name, passed: false, error: String(error) }); }
  }
}
process.stdout.write(JSON.stringify({ timezone: process.env.TZ, checks }) + "\n");
