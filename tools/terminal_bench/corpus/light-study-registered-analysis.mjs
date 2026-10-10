// Reuse shared computations and bind their endpoints to this campaign's registration.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const directory=resolve(process.argv[2]);
const protocolBytes=await readFile(join(directory,'protocol.json'));
const protocol=JSON.parse(protocolBytes);
const registration={registeredAt:protocol.registeredAt,protocolSha256:createHash('sha256').update(protocolBytes).digest('hex')};
for (const helper of ['light-study-compare.mjs','light-study-completion-compare.mjs'])
  execFileSync(process.execPath,[fileURLToPath(new URL(helper,import.meta.url)),directory],{stdio:'ignore'});
const completed=join(directory,'completed-paired-comparison.json');
const comparison=JSON.parse(await readFile(completed,'utf8'));
comparison.inheritedHelperSelection=comparison.selection;
comparison.selection='Instruction criteria AND successful runtime completion registered before this campaign outcomes. Computation unchanged; the shared helper first introduced this qualification retrospectively in the previous H3 campaign.';
comparison.registration=registration;
await writeFile(completed,JSON.stringify(comparison,null,2)+'\n');
for (const filename of ['webhook-replay.json','pagination-replay.json','reducer-replay.json']) {
  const file=join(directory,filename);let replay;
  try {replay=JSON.parse(await readFile(file,'utf8'));} catch(e){if(e.code==='ENOENT')continue;throw e;}
  replay.inheritedHelperSelection=replay.selection;
  replay.selection='Previously identified convention/counterexample, registered before this campaign outcomes and applied uniformly to every matching solution. Original score unchanged; no source repair or task-agent feedback.';
  replay.registration=registration;
  await writeFile(file,JSON.stringify(replay,null,2)+'\n');
}
console.log(JSON.stringify({registration,comparisons:comparison.comparisons.length,excludedDespiteAuditedCriteria:comparison.excludedDespiteAuditedCriteria}));
