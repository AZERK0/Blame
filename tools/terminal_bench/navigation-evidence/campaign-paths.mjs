import { join, resolve } from "node:path";

export const repo = resolve(new URL("../../..", import.meta.url).pathname);
const variant = process.env.BLAME_STUDY_VARIANT ?? "";
if (variant && !/^[a-z0-9][a-z0-9-]{0,40}$/u.test(variant))
  throw new Error("Invalid study variant; use a new bounded campaign identifier");
export const work = join(repo, ".blame/research/navigation-evidence" + (variant ? "-" + variant : ""));
export const studyFor = panel => join(repo,
  `docs/experiments/light-harness-navigation-evidence-${panel}-2026-10-13${variant ? "-" + variant : ""}`);
