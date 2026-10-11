import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scenarioChecks } from './scenario-checks.mjs';
const workspace = await mkdtemp(join(tmpdir(), 'blame-t3-graders-'));
try {
  await cp(new URL('./fixture/', import.meta.url), workspace, { recursive: true });
  const ids = ['root-backoff','child-label','shared-batch'];
  for (const id of ids) assert.ok((await scenarioChecks(id, workspace)).some(c => !c.passed), 'Seed must fail ' + id);
  await writeFile(join(workspace,'src/backoff.ts'), 'export const RETRY_LABEL="Retry";export function retryDelay(a:number,b:number):number{if(!Number.isInteger(a)||a<0||a>10||!Number.isInteger(b)||b<0||b>1000000)throw new RangeError();return Math.min(5000,b*2**a);}');
  await writeFile(join(workspace,'packages/labels/src/label.ts'), 'export const ASSET_PREFIX="asset:";export function assetLabel(s:string):string{const name=s.trim();if(!name)throw new RangeError();return ASSET_PREFIX+name.toLowerCase();}');
  await writeFile(join(workspace,'packages/settings/src/settings.ts'), 'export const MAX_BATCH=4;export const BATCH_LABEL="Batch";');
  for (const id of ids) assert.ok((await scenarioChecks(id, workspace)).every(c => c.passed), 'Independent positive ' + id);
  await writeFile(join(workspace,'src/backoff.ts'), 'export function retryDelay(a:number,b:number):number{while(true){}}');
  assert.ok((await scenarioChecks('root-backoff',workspace)).some(c => !c.passed), 'Hang must be bounded');
  console.log('Three seed negatives rejected, independent positives accepted, hanging code bounded. Examples stayed outside all agent workspaces.');
} finally { await rm(workspace, { recursive: true, force: true }); }
