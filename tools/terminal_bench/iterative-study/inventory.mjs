// Seal publication bytes; verification independently checks contracts/arithmetic.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { study as defaultStudy, save, sha } from './setup.mjs';
export async function inventory(study) {
  const files = {};
  for (const entry of await readdir(study, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || ['publication-inventory.json', 'publication-checks.json', 'publication-controls.json'].includes(entry.name)) continue;
    const path = join(entry.parentPath, entry.name); files[relative(study, path)] = sha(await readFile(path));
  }
  await save(join(study, 'publication-inventory.json'), files);
}
if (process.argv[1] === new URL(import.meta.url).pathname) await inventory(resolve(process.argv[2] ?? defaultStudy));
