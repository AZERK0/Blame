// Held-out feature verifier. Never copied into a model workspace.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const workspace = resolve(process.argv[2]);
const task = process.argv[3];
const checks: { name: string; passed: boolean; error?: string }[] = [];
function check(name: string, run: () => void) {
  try { run(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: String(error).slice(0, 1200) }); }
}
const load = (path: string) => import(pathToFileURL(resolve(workspace, path)).href);
if (task === "iso-fractions") {
  const { formatISO } = await load("src/formatISO/index.ts");
  for (const milliseconds of [0, 1, 9, 10, 99, 100, 234, 999]) {
    for (const format of ["basic", "extended"]) {
      for (const representation of ["complete", "time", "date"]) {
        check([milliseconds, format, representation].join(":"), () => {
          const date = new Date(2021, 5, 9, 12, 34, 56, milliseconds);
          const before = date.getTime();
          const datePart = format === "basic" ? "20210609" : "2021-06-09";
          const time = format === "basic" ? "123456" : "12:34:56";
          const offset = date.getTimezoneOffset();
          const magnitude = Math.abs(offset);
          const zone = offset === 0 ? "Z" : (offset < 0 ? "+" : "-") +
            String(Math.trunc(magnitude / 60)).padStart(2, "0") + ":" +
            String(magnitude % 60).padStart(2, "0");
          const prefix = representation === "time" ? "" : datePart + "T";
          const expected = representation === "date" ? datePart :
            prefix + time + "." + String(milliseconds).padStart(3, "0") + zone;
          assert.equal(formatISO(date, { format, representation, fractionDigits: 3 }), expected);
          assert.equal(date.getTime(), before);
          assert.equal(formatISO(date, { format, representation, fractionDigits: 0 }),
            formatISO(date, { format, representation }));
        });
      }
    }
  }
  for (const value of [-1, 1, 2, 4, 3.5, NaN, Infinity, "3", null, false]) {
    check("invalid:" + String(value), () => {
      for (const representation of ["date", "complete", "time"])
        assert.throws(() => formatISO(new Date(), { fractionDigits: value, representation }), RangeError);
    });
  }
  check("invalid date", () => assert.throws(() => formatISO(new Date(NaN), { fractionDigits: 3 }), RangeError));
  check("public option type", () => assert.match(
    readFileSync(resolve(workspace, "src/formatISO/index.ts"), "utf8"),
    /fractionDigits\s*\?\s*:\s*(?:0\s*\|\s*3|3\s*\|\s*0)\s*[;,]/u));
} else if (task === "duration-limit") {
  const { formatDuration } = await load("src/formatDuration/index.ts");
  const duration = Object.freeze({ years: 1, months: 0, days: 2, seconds: 3 });
  for (const format of [undefined, ["seconds", "months", "years", "days"], ["years", "years", "days"]]) {
    for (const zero of [false, true]) {
      for (const maxUnits of [0, 1, 2, 3, 4, 20]) {
        check(JSON.stringify({ format, zero, maxUnits }), () => {
          const options = Object.freeze({ format: format && Object.freeze(format), zero, delimiter: "|", maxUnits });
          const base = formatDuration(duration, { format, zero, delimiter: "|" });
          assert.equal(formatDuration(duration, options), base.split("|").slice(0, maxUnits).join("|"));
        });
      }
    }
  }
  for (const value of [-1, 1.5, NaN, Infinity, -Infinity, "2", null, false]) {
    check("invalid:" + String(value), () => {
      assert.throws(() => formatDuration({}, { maxUnits: value }), RangeError);
      assert.throws(() => formatDuration(duration, { maxUnits: value }), RangeError);
    });
  }
  check("custom locale", () => {
    const locale = { formatDistance: (token: string, value: number) => token + "=" + value };
    assert.equal(formatDuration(duration, { locale, maxUnits: 2, delimiter: "/" }), "xYears=1/xDays=2");
  });
  check("empty duration", () => {
    assert.equal(formatDuration({}, { maxUnits: 2 }), "");
    assert.equal(formatDuration({}, { maxUnits: 0 }), "");
  });
  check("public option type", () => assert.match(
    readFileSync(resolve(workspace, "src/formatDuration/index.ts"), "utf8"), /maxUnits\s*\?\s*:\s*number\s*[;,]/u));
} else if (task === "shared-day-millis") {
  const { format } = await load("src/format/index.ts");
  const { lightFormat } = await load("src/lightFormat/index.ts");
  for (const [hour, minute, second, millisecond] of [
    [0, 0, 0, 0], [0, 0, 0, 7], [0, 0, 1, 1], [1, 2, 3, 4], [12, 34, 56, 789], [23, 59, 59, 999],
  ]) {
    for (const token of ["J", "JJ", "JJJ", "JJJJJJJJJJ"]) {
      check([hour, minute, second, millisecond, token].join(":"), () => {
        const date = new Date(2021, 5, 9, hour, minute, second, millisecond);
        const before = date.getTime();
        const value = ((hour * 60 + minute) * 60 + second) * 1000 + millisecond;
        const expected = format(date, token);
        if (token === "J") assert.equal(expected, String(value));
        else {
          assert.match(expected, /^\d{8,}$/u);
          assert.equal(Number(expected), value);
          assert.equal(expected, String(value).padStart(expected.length, "0"));
        }
        assert.equal(format(date, token), expected);
        assert.equal(lightFormat(date, token), expected);
        assert.equal(date.getTime(), before);
        assert.equal(format(date, "'J JJ' " + token), "J JJ " + expected);
        assert.equal(lightFormat(date, "'J JJ' " + token), "J JJ " + expected);
      });
    }
  }
  check("shared delegation", () => assert.match(
    readFileSync(resolve(workspace, "src/_lib/format/formatters/index.ts"), "utf8"),
    /lightFormatters\.J/u));
} else throw new Error("Unknown preselected task");
process.stdout.write(JSON.stringify({ task, timezone: process.env.TZ, checks }) + "\n");
