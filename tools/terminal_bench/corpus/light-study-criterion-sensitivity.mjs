import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const directory=resolve(process.argv[2]);
const raw=await readFile(join(directory,'results.json'));const original=JSON.parse(raw);
const decisions=JSON.parse(await readFile(join(directory,'adjudication.json'),'utf8')).decisions;
const comparisons=[];
for(const expandedDates of [true,false])for(const physicalAbsence of [true,false]) {
 const results=structuredClone(original);const counts={};
 for(const row of results.rows) {
  const d=decisions.find(d=>d.name===row.name);let criteria=d.independentSuccess;
  if(!expandedDates&&row.id==='stable-pagination')criteria=d.normalizedTimestampSensitivitySuccess;
  if(!physicalAbsence&&row.id==='stale-save-reducer')criteria=d.valueSemanticsSensitivitySuccess;
  assertBoolean(criteria,row.name);
  counts[row.arm]??={trials:0,auditedCriteria:0,auditedCompletion:0};const c=counts[row.arm];c.trials++;c.auditedCriteria+=Number(criteria);c.auditedCompletion+=Number(criteria&&row.status==='succeeded');
  row.auditedSuccess=criteria&&row.status==='succeeded';
 }
 const temporary=await mkdtemp(join(tmpdir(),'blame-convention-comparison-'));
 try {
  await writeFile(join(temporary,'results.json'),JSON.stringify(results));
  execFileSync(process.execPath,[fileURLToPath(new URL('./light-study-compare.mjs',import.meta.url)),temporary],{stdio:'ignore'});
  const paired=JSON.parse(await readFile(join(temporary,'paired-comparison.json'),'utf8'));
  comparisons.push({timestampConvention:expandedDates?'valid ISO offsets/equal instants':'canonical normalized timestamps',optionalFields:physicalAbsence?'physical absence':'undefined value allowed',counts,paired:paired.comparisons});
 } finally {await rm(temporary,{recursive:true,force:true});}
}
const result={selection:'All four previously identified convention combinations, registered before this campaign outcomes, applied uniformly. Original score and strict primary audit remain unchanged. Both-success resource comparisons additionally require runtime completion; no favorable convention selected.',originalResultsSha256:createHash('sha256').update(raw).digest('hex'),comparisons};
await writeFile(join(directory,'criterion-sensitivity.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(comparisons.map(({timestampConvention,optionalFields,counts})=>({timestampConvention,optionalFields,counts}))));
function assertBoolean(value,name){if(typeof value!=='boolean')throw new Error(`Missing criterion convention for ${name}`);}
