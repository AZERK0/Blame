#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith("--"));
const format = valueOf("--format") ?? "json";
const outputPath = valueOf("--output");

if (!inputPath || !["json", "names", "markdown"].includes(format)) {
  console.error(
    "Usage: node scripts/extract-open-source-projects.mjs <licenses.txt> " +
      "[--format=json|names|markdown] [--output=path]",
  );
  process.exit(1);
}

const source = await readFile(inputPath, "utf8");
const entryPattern =
  /The following software may be included in this product:\s+(.+?)\s*\(([^)]+)\)/g;
const projects = new Map();
let entries = 0;
let match;

while ((match = entryPattern.exec(source)) !== null) {
  entries += 1;
  const name = match[1].trim();
  const version = match[2].trim();
  const versions = projects.get(name) ?? new Set();
  versions.add(version);
  projects.set(name, versions);
}

const rows = [...projects.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, versions]) => ({
    name,
    versions: [...versions].sort(),
  }));

let result;
if (format === "names") {
  result = rows.map(({ name }) => name).join("\n") + "\n";
} else if (format === "markdown") {
  result = [
    "# Open-source projects",
    "",
    `Source: \`${inputPath}\``,
    `Entries: ${entries}`,
    `Unique projects: ${rows.length}`,
    "",
    ...rows.map(
      ({ name, versions }) => `- ${name} (${versions.join(", ")})`,
    ),
    "",
  ].join("\n");
} else {
  result =
    JSON.stringify(
      {
        source: inputPath,
        entries,
        uniqueProjects: rows.length,
        projects: rows,
      },
      null,
      2,
    ) + "\n";
}

if (outputPath) {
  await writeFile(outputPath, result);
} else {
  process.stdout.write(result);
}

function valueOf(flag) {
  const argument = args.find(
    (value) => value === flag || value.startsWith(`${flag}=`),
  );
  if (!argument) return undefined;
  return argument === flag ? undefined : argument.slice(flag.length + 1);
}
