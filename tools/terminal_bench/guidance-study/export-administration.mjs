// Preserve infrastructure interruptions independently of model outcomes.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const interruption=await json(join(work,'administration/preparation-interruption.json'));
const continuation=await json(join(work,'administration/continuation.json'));
assert.equal(sha(await readFile(join(repo,continuation.driver))),continuation.driverSha256);
for(const [name,files]of Object.entries(continuation.completedTrialHashes))for(const [file,expected]of Object.entries(files))
 assert.equal(sha(await readFile(join(work,'f28',name,file))),expected,name+':'+file);
assert.equal(interruption.modelDispatched,false);assert.equal(interruption.modelRetries,0);
assert.equal(interruption.completedPrefix,13);
for(const [path,expected]of Object.entries(interruption.preservedFileSha256))
 assert.equal(sha(await readFile(join(repo,interruption.preservedDirectory,path))),expected,path);
for(const file of ['model-start.json','model-child.json','instruction.txt','required-checks.json','events.jsonl','result.json'])
 await assert.rejects(readFile(join(repo,interruption.preservedDirectory,file)),error=>error.code==='ENOENT');
const inventory=[];
for(const [file,path]of [
 ['preparation-interruption.json',join(work,'administration/preparation-interruption.json')],
 ['inode-bootstrap.json',join(work,'administration/inode-bootstrap.json')],
 ['object-compaction.jsonl',join(work,'administration/object-compaction.jsonl')],
 ['original-orchestration.log',join(work,'run.log')],
 ['continued-orchestration.log',join(work,'resume.log')],
 ['continuation.json',join(work,'administration/continuation.json')]
]){
 const bytes=await readFile(path),artifact='administration/'+file+'.gz';
 await mkdir(join(study,'administration'),{recursive:true});await writeFile(join(study,artifact),gzipSync(bytes,{mtime:0}));
 inventory.push({file,artifact,bytes:bytes.length,sha256:sha(bytes)});
}
assert.equal(inventory.find(e=>e.file==='original-orchestration.log').sha256,interruption.originalLogSha256);
const output={completedPrefix:13,affectedAssignment:interruption.affectedAssignment,
 infrastructureFailure:'Root inode exhaustion during pre-dispatch git add; byte capacity was still available.',
 modelDispatchedForFailedPreparation:false,modelRetries:0,sourceRepair:false,registeredDriverChanged:false,
 failedPreparationPreservedAndVerified:true,filesVerified:Object.keys(interruption.preservedFileSha256).length,
 action:'Historical repository object compaction preserves commit/ref identities and tracked source diffs. The temporary exact object copy is restored. Continue the unchanged runner at the next assigned trial; no completed outcome is rerun.',
 administrativeDowntimeSeconds:(Date.parse(continuation.continuedAtUTC)-Date.parse(continuation.originalFailureLoggedAtUTC))/1000,
 timing:'Administrative downtime is excluded from per-worker durations; disclose it separately from model time. Provider cache state and timing effects of the interruption are not identified.',inventory};
await writeFile(join(study,'administrative-recovery.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({...output,inventory:inventory.length}));
