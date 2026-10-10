// Grader self-checks only; these programs are never placed in model workspaces.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { scenarioChecks } from './scenario-checks.mjs';
const fixture = new URL('./fixture/',import.meta.url);
const examples = {
  'cents-allocation':['src/allocation.ts',`export function allocateCents(total:number,n:number){if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(n)||n<1||n>10000)throw new RangeError();const base=Math.floor(total/n),remaining=total-base*n;return Array.from({length:n},(_,i)=>base+(i<remaining?1:0));}`],
  'revision-guard':['src/revision.ts',`export function applyRevision(s:{revision:number;title:string;owner:string},u:{revision:number;title:string}){if(!Number.isSafeInteger(u.revision)||u.revision<0)throw new RangeError();return u.revision<=s.revision?s:{owner:s.owner,revision:u.revision,title:u.title};}`],
  'retry-backoff':['src/backoff.ts',`export function retryDelay(n:number){if(!Number.isSafeInteger(n)||n<0)throw new RangeError();return Math.min(10000,200*2**n);}export function shouldRetry(n:number){return n===429||n>=500;}`],
  'card-hierarchy':['src/card.css',`.project-card {background:#f8fafc;color:#0f172a;padding:24px;border-radius:12px;} .project-card__title {font-size:24px;font-weight:700;margin:0;line-height:1.25;} .project-card__action {color:#1d4ed8;text-decoration:underline;text-underline-offset:3px;}`],
};
const directory = await mkdtemp(join(tmpdir(),'blame-confirmation-grader-'));
const rows=[];
try {
  await cp(fixture,directory,{recursive:true});
  for (const [id,[file,source]] of Object.entries(examples)) {
    const baseline=await scenarioChecks(id,directory);assert.ok(baseline.some(x=>!x.passed));
    await writeFile(join(directory,file),source);
    const positive=await scenarioChecks(id,directory);assert.ok(positive.every(x=>x.passed),JSON.stringify({id,positive}));
    rows.push({id,baseline,positive});
  }
  await writeFile(join(directory,'src/backoff.ts'),'export function retryDelay(n:number){while(true){}};export function shouldRetry(n:number){return n===429||n>=500;}');
  assert.equal((await scenarioChecks('retry-backoff',directory))[0].passed,false);
} finally {await rm(directory,{recursive:true,force:true});}
console.log(JSON.stringify({rows,boundedHangCheck:'passed',graderSha256:createHash('sha256').update(await readFile(new URL('./scenario-checks.mjs',import.meta.url))).digest('hex'),note:'Validator self-checks before model execution; examples never enter model workspaces.'},null,2));
