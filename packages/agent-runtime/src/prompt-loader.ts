import { readFileSync } from "node:fs";

export function loadPrompt(name: string) {
  return readFileSync(
    new URL(`./prompt/${name}.txt`, import.meta.url),
    "utf8",
  ).trim();
}
