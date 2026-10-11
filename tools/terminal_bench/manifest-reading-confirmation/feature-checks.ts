// New-task held-out verifier; never copy into model workspaces or provide feedback.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const workspace = resolve(process.argv[2]), task = process.argv[3];
const load = (path: string) => import(pathToFileURL(resolve(workspace, path)).href);
const checks: { name: string; passed: boolean; error?: string }[] = [];
function check(name: string, run: () => void) {
  try { run(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, error: String(error).slice(0, 1200) }); }
}
if (task === "sql-fractions") {
  const { formatISO9075 } = await load("src/formatISO9075/index.ts");
  for (const ms of [0, 1, 9, 10, 99, 100, 234, 999])
    for (const format of ["basic", "extended"])
      for (const representation of ["complete", "time", "date"])
        check([ms, format, representation].join(":"), () => {
          const date = new Date(2021, 5, 9, 12, 34, 56, ms), before = +date;
          const datePart = format === "basic" ? "20210609" : "2021-06-09";
          const timePart = format === "basic" ? "123456" : "12:34:56";
          const expected = representation === "date" ? datePart :
            (representation === "complete" ? datePart + " " : "") + timePart + "." + String(ms).padStart(3, "0");
          assert.equal(formatISO9075(date, Object.freeze({ format, representation, fractionDigits: 3 })), expected);
          assert.equal(formatISO9075(date, { format, representation, fractionDigits: 0 }),
            formatISO9075(date, { format, representation }));
          assert.equal(formatISO9075(date, { format, representation, fractionDigits: undefined }),
            formatISO9075(date, { format, representation }));
          assert.equal(+date, before);
        });
  for (const value of [-1, 1, 2, 4, 3.5, NaN, Infinity, "3", null, false])
    check("invalid:" + String(value), () => {
      for (const representation of ["date", "time", "complete"])
        assert.throws(() => formatISO9075(new Date(), { fractionDigits: value, representation }), RangeError);
    });
  check("invalid date", () => assert.throws(() => formatISO9075(new Date(NaN), { fractionDigits: 3 }), RangeError));
  check("context", () => {
    let called = 0;
    const input = new Date(0);
    const result = formatISO9075(input, { fractionDigits: 3, in: () => {
      called++; return new Date(2021, 5, 9, 12, 34, 56, 123);
    } });
    assert.equal(result, "2021-06-09 12:34:56.123"); assert.ok(called); assert.equal(+input, 0);
  });
  check("public option type", () => assert.match(readFileSync(resolve(workspace, "src/formatISO9075/index.ts"), "utf8"),
    /fractionDigits\s*\?\s*:\s*(?:0\s*\|\s*3|3\s*\|\s*0)\s*[;,]/u));
} else if (task === "iso-duration-zeros") {
  const { formatISODuration } = await load("src/formatISODuration/index.ts");
  const cases = [
    [{}, "PT0S"], [{ years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 }, "PT0S"],
    [{ years: 1 }, "P1Y"], [{ months: 2, days: 3 }, "P2M3D"], [{ hours: 4 }, "PT4H"],
    [{ minutes: 5, seconds: 6 }, "PT5M6S"], [{ days: 1, seconds: 0 }, "P1D"],
    [{ years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6 }, "P1Y2M3DT4H5M6S"],
    [{ years: -1, seconds: 0.5 }, "P-1YT0.5S"], [{ days: 1.25, hours: -2 }, "P1.25DT-2H"],
    [{ seconds: -0 }, "PT0S"], [{ weeks: 2 }, "PT0S"],
  ] as const;
  for (const [duration, expected] of cases) check(JSON.stringify(duration), () => {
    const frozen = Object.freeze({ ...duration }), before = JSON.stringify(frozen);
    assert.equal(formatISODuration(frozen, Object.freeze({ omitZeroUnits: true })), expected);
    const { years = 0, months = 0, days = 0, hours = 0, minutes = 0, seconds = 0 } = frozen as any;
    const legacy = "P" + years + "Y" + months + "M" + days + "DT" + hours + "H" + minutes + "M" + seconds + "S";
    for (const options of [undefined, {}, { omitZeroUnits: false }, { omitZeroUnits: undefined }])
      assert.equal(formatISODuration(frozen, options), legacy);
    assert.equal(JSON.stringify(frozen), before);
  });
  for (const value of [0, 1, "true", null, NaN, {}, []]) check("invalid:" + JSON.stringify(value), () => {
    assert.throws(() => formatISODuration({}, { omitZeroUnits: value }), RangeError);
    assert.throws(() => formatISODuration({ seconds: 1 }, { omitZeroUnits: value }), RangeError);
  });
  check("public option type", () => {
    const source = readFileSync(resolve(workspace, "src/formatISODuration/index.ts"), "utf8");
    assert.match(source, /export\s+interface\s+FormatISODurationOptions/u);
    assert.match(source, /omitZeroUnits\s*\?\s*:\s*boolean\s*[;,]/u);
  });
} else if (task === "day-list-limit") {
  const { eachDayOfInterval } = await load("src/eachDayOfInterval/index.ts");
  for (const reversed of [false, true]) for (const step of [-3, -2, -1, 0, 1, 2, 3])
    for (const maxDates of [0, 1, 2, 4, 20]) check([reversed, step, maxDates].join(":"), () => {
      const first = new Date(2021, 2, 12, 15), last = new Date(2021, 2, 18, 13);
      const interval = Object.freeze({ start: reversed ? last : first, end: reversed ? first : last });
      const before = [+first, +last], options = Object.freeze({ step, maxDates });
      const legacy = eachDayOfInterval(interval, { step });
      const actual = eachDayOfInterval(interval, options);
      assert.deepEqual(actual.map(Number), legacy.slice(0, maxDates).map(Number));
      assert.ok(actual.every((date: Date) => date.getHours() === 0 && date.getMinutes() === 0));
      assert.deepEqual([+first, +last], before);
      assert.deepEqual(eachDayOfInterval(interval, { step, maxDates: undefined }).map(Number), legacy.map(Number));
    });
  for (const value of [-1, 1.5, NaN, Infinity, -Infinity, "2", null, false])
    check("invalid:" + String(value), () => {
      for (const step of [0, 1])
        assert.throws(() => eachDayOfInterval({ start: new Date(NaN), end: new Date(NaN) },
          { step, maxDates: value }), RangeError);
    });
  check("invalid interval unchanged", () => assert.deepEqual(
    eachDayOfInterval({ start: new Date(NaN), end: new Date(NaN) }, { maxDates: 3 }), []));
  check("date subtype and context", () => {
    class CustomDate extends Date {}
    const interval = { start: new CustomDate(2021, 2, 12), end: new CustomDate(2021, 2, 18) };
    assert.ok(eachDayOfInterval(interval, { maxDates: 2 }).every((date: Date) => date instanceof CustomDate));
    assert.ok(eachDayOfInterval({ start: 0, end: 86400000 * 3 }, { maxDates: 2,
      in: (value: any) => new CustomDate(value) }).every((date: Date) => date instanceof CustomDate));
  });
  check("public option type", () => assert.match(readFileSync(resolve(workspace, "src/eachDayOfInterval/index.ts"), "utf8"),
    /maxDates\s*\?\s*:\s*number\s*[;,]/u));
} else throw new Error("Unknown preselected task");
process.stdout.write(JSON.stringify({ task, timezone: process.env.TZ, checks }) + "\n");
