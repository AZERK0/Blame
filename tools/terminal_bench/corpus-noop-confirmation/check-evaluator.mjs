import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenarioChecks } from './scenario-checks.mjs';
const workspace = await mkdtemp(join(tmpdir(), 'blame-noop-evaluator-'));
const positives = {
  'issue-tag': ['src/issue-tag.ts', 'export const TAG_LABEL = "Tag";\n\nexport function normalizeIssueTag(text: string): string {\n  const value = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");\n  return value || "untagged";\n}\n'],
  'priority-score': ['src/priority.ts', 'export const PRIORITY_LABEL = "Priority";\n\nexport function priorityForScore(score: number): "low" | "normal" | "high" {\n  if (!Number.isInteger(score) || score < 0 || score > 100) throw new RangeError();\n  return score < 33 ? "low" : score < 66 ? "normal" : "high";\n}\n'],
  'receipt-summary': ['src/receipt.ts', 'export type ReceiptLine = { priceCents: number; quantity: number };\nexport type ReceiptSummary = { count: number; totalCents: number };\n\nexport function summarizeReceipt(lines: readonly ReceiptLine[]): ReceiptSummary {\n  let count = 0, totalCents = 0;\n  for (const line of lines) {\n    if (!Number.isSafeInteger(line.priceCents) || line.priceCents < 0 || !Number.isSafeInteger(line.quantity) || line.quantity < 0) throw new RangeError();\n    const product = line.priceCents * line.quantity;\n    count += line.quantity;\n    totalCents += product;\n    if (!Number.isSafeInteger(product) || !Number.isSafeInteger(count) || !Number.isSafeInteger(totalCents)) throw new RangeError();\n  }\n  return { totalCents, count };\n}\n'],
};
try {
  await cp(new URL('./fixture/', import.meta.url), workspace, { recursive: true });
  for (const [id, [path, positive]] of Object.entries(positives)) {
    const negative = await scenarioChecks(id, workspace);
    assert.ok(negative.some(c => !c.passed), 'Original seed must fail ' + id);
    await writeFile(join(workspace, path), positive);
    assert.ok((await scenarioChecks(id, workspace)).every(c => c.passed), 'Independent positive ' + id);
    // The functional answer alone must not erase the expressly requested layout.
    await writeFile(join(workspace, path), positive.replace(/\n  (?=\S)/g, '\n    '));
    const wrongLayout = await scenarioChecks(id, workspace);
    assert.equal(wrongLayout.find(c => c.name.startsWith('multiline')).passed, false);
    assert.ok(wrongLayout.filter(c => !c.name.startsWith('multiline')).every(c => c.passed), 'Layout is distinct from behavior ' + id);
    await writeFile(join(workspace, path), positive);
  }
  const [path, positive] = positives['priority-score'];
  await writeFile(join(workspace, path), positive.replace('score < 33 ? "low" : score < 66 ? "normal" : "high"', '"high"'));
  assert.ok((await scenarioChecks('priority-score', workspace)).some(c => !c.passed), 'Behavior defect must fail despite correct layout');
  await writeFile(join(workspace, path), positive.replace('if (!Number.isInteger(score) || score < 0 || score > 100) throw new RangeError();', 'while (true) {}'));
  assert.ok((await scenarioChecks('priority-score', workspace)).some(c => !c.passed), 'Hanging model code must be bounded');
  const originalTag = positives['issue-tag'][1];
  await writeFile(join(workspace, 'src/issue-tag.ts'), originalTag.replace('TAG_LABEL = "Tag"', 'TAG_LABEL = "Changed"'));
  assert.equal((await scenarioChecks('issue-tag', workspace))[0].passed, false, 'Outside-code preservation is required');
  console.log('Three original negatives rejected; independent positives including reordered return properties pass; behavior/layout/preservation defects and hangs fail. Examples stayed outside agent workspaces.');
} finally { await rm(workspace, { recursive: true, force: true }); }
