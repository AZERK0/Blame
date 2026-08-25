import { readFile } from "node:fs/promises";
import { parse, printParseErrorCode } from "jsonc-parser";

const errors = [];
parse(
  await readFile(new URL("../portfolio.jsonc", import.meta.url), "utf8"),
  errors,
);
if (errors.length) {
  process.stderr.write(
    errors.map((error) => printParseErrorCode(error.error)).join("\n"),
  );
  process.exitCode = 1;
}
