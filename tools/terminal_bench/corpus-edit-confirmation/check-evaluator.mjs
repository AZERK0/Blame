import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scenarioChecks } from './scenario-checks.mjs';
const workspace=await mkdtemp(join(tmpdir(),'blame-t2-graders-'));
try {
  await cp(new URL('./fixture/',import.meta.url),workspace,{recursive:true});
  for(const id of ['interval-union','duration-format','notification-config'])
    assert.ok((await scenarioChecks(id,workspace)).some(c=>!c.passed),'Seed must fail '+id);
  // Independent reference examples stay outside all agent workspaces.
  await writeFile(join(workspace,'src/intervals.ts'),`export type Range = readonly [number,number];
export function mergeRanges(ranges:readonly Range[]):Range[]{
 const sorted=ranges.map(([a,b])=>{if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a>b)throw new RangeError();return [a,b];}).sort((a,b)=>a[0]-b[0]);
 const result:number[][]=[];for(const range of sorted){const previous=result.at(-1);if(previous&&range[0]<=previous[1])previous[1]=Math.max(previous[1],range[1]);else result.push(range);}return result as [number,number][];
}`);
  await writeFile(join(workspace,'src/duration.ts'),`export const DURATION_LABEL="Elapsed";
export function formatDuration(ms:number):string{if(!Number.isSafeInteger(ms)||ms<0)throw new RangeError();const seconds=Math.floor(ms/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,"0")).join(":");}`);
  await writeFile(join(workspace,'src/notifications.json'),JSON.stringify({metadata:{schemaVersion:1,owner:'operations'},features:{marketing:false,digest:true},delivery:{channel:'email',timeoutMs:5000,retryLimit:4}}));
  for(const id of ['interval-union','duration-format','notification-config'])
    assert.ok((await scenarioChecks(id,workspace)).every(c=>c.passed),'Positive reference '+id);
  await writeFile(join(workspace,'src/duration.ts'),'export function formatDuration(){while(true){}}');
  assert.ok((await scenarioChecks('duration-format',workspace)).every(c=>!c.passed),'Hang must be bounded');
  console.log('Three seeded negatives rejected, independent positives accepted, and hanging source bounded.');
} finally {await rm(workspace,{recursive:true,force:true});}
