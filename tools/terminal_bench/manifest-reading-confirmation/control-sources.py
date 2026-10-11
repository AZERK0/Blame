#!/usr/bin/env python3
"""Generate private independent positive controls, never used for model recovery."""
import argparse
import subprocess
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument("upstream", type=Path)
parser.add_argument("destination", type=Path)
parser.add_argument("--task", choices=["sql-fractions", "iso-duration-zeros", "day-list-limit"])
args = parser.parse_args()
assert not args.destination.exists()
subprocess.run(["git", "-c", "advice.detachedHead=false", "clone", "--shared", "--no-hardlinks",
                "--quiet", str(args.upstream), str(args.destination)], check=True)
(args.destination / "node_modules").symlink_to((args.upstream / "node_modules").resolve())
path = args.destination / "src/formatISO9075/index.ts"
source = path.read_text().replace("ContextOptions<Date> {}", "ContextOptions<Date> {\n  fractionDigits?: 0 | 3;\n}")
source = source.replace('  const format = options?.format ?? "extended";', '''
  const fractionDigits = options?.fractionDigits;
  if (fractionDigits !== undefined && fractionDigits !== 0 && fractionDigits !== 3) {
    throw new RangeError("fractionDigits");
  }
  const format = options?.format ?? "extended";''')
source = source.replace("    const second = addLeadingZeros(date_.getSeconds(), 2);",
                        '''    const second = addLeadingZeros(date_.getSeconds(), 2) +
      (fractionDigits === 3 ? "." + addLeadingZeros(date_.getMilliseconds(), 3) : "");''')
path.write_text(source)
path = args.destination / "src/formatISODuration/index.ts"
source = path.read_text().replace(
    'import type { Duration } from "../types.js";',
    'import type { Duration } from "../types.js";\n\nexport interface FormatISODurationOptions {\n  omitZeroUnits?: boolean;\n}')
source = source.replace("formatISODuration(duration: Duration)", "formatISODuration(duration: Duration, options?: FormatISODurationOptions)")
source = source.replace("  const {", '''  const flag = options?.omitZeroUnits;
  if (flag !== undefined && typeof flag !== "boolean") throw new RangeError("omitZeroUnits");
  const {''', 1)
source = source.replace("  return " + chr(96), '''  if (flag) {
    const emit = (items: [number, string][]) => items.filter(([value]) => value !== 0)
      .map(([value, unit]) => String(value) + unit).join("");
    const date = emit([[years, "Y"], [months, "M"], [days, "D"]]);
    const time = emit([[hours, "H"], [minutes, "M"], [seconds, "S"]]);
    return date || time ? "P" + date + (time ? "T" + time : "") : "PT0S";
  }
  return ''' + chr(96), 1)
path.write_text(source)
path = args.destination / "src/eachDayOfInterval/index.ts"
source = path.read_text().replace("ContextOptions<DateType> {}", "ContextOptions<DateType> {\n  maxDates?: number;\n}")
source = source.replace("  const { start, end }", '''  const maxDates = options?.maxDates;
  if (maxDates !== undefined &&
      (!Number.isFinite(maxDates) || !Number.isInteger(maxDates) || maxDates < 0))
    throw new RangeError("maxDates");
  if (maxDates === 0) return [];
  const { start, end }''', 1)
source = source.replace("  return reversed ? dates.reverse() : dates;",
                        "  const ordered = reversed ? dates.reverse() : dates;\n  return maxDates === undefined ? ordered : ordered.slice(0, maxDates);")
path.write_text(source)
if args.task:
    allowed = {"sql-fractions": "src/formatISO9075/index.ts",
               "iso-duration-zeros": "src/formatISODuration/index.ts",
               "day-list-limit": "src/eachDayOfInterval/index.ts"}[args.task]
    others = [path for path in ["src/formatISO9075/index.ts", "src/formatISODuration/index.ts",
                               "src/eachDayOfInterval/index.ts"] if path != allowed]
    subprocess.run(["git", "restore", "--", *others], cwd=args.destination, check=True)
