// Register known semantic diagnostics as primary before this campaign outcomes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const root=resolve(process.argv[2]),destination=resolve(process.argv[3]);
const protocolBytes=await readFile(join(destination,'protocol.json'));
const protocol=JSON.parse(protocolBytes);
assert.ok(protocol.intervention.startsWith('T3:'));
const analysis=JSON.parse(await readFile(join(root,'analysis.json')));
const baseBytes=await readFile(join(root,'adjudication.json'));
await writeFile(join(root,'base-adjudication.json'),baseBytes);
const audit=JSON.parse(baseBytes);
for(const [id,file] of [['slug-contract','slug-replay.json'],['storage-traversal','storage-percent-replay.json']]) {
  if(!analysis.rows.some(r=>r.id===id))continue;
  const replay=JSON.parse(await readFile(join(root,file)));
  replay.inheritedHelperSelection=replay.selection;
  replay.selection='Known semantic counterexample registered as a primary T3 criterion before model outcomes, applied uniformly. Earlier campaigns retain their own historical endpoints; no agent feedback or source repair.';
  replay.registration={registeredAt:protocol.registeredAt,protocolSha256:createHash('sha256').update(protocolBytes).digest('hex')};
  for(const row of analysis.rows.filter(r=>r.id===id)) {
    const decision=audit.decisions.find(d=>d.name===row.name);
    const check=replay.rows.find(r=>r.name===row.name);assert.equal(typeof check?.passed,'boolean');
    const sourcePath=id==='slug-contract'?'src/slug.ts':'src/storage-path.ts';
    assert.equal(check.sourceSha256,createHash('sha256').update(await readFile(join(root,row.name,'workspace',sourcePath))).digest('hex'));
    assert.equal(row.diffSha256,createHash('sha256').update(await readFile(join(root,row.name,'workspace.diff'))).digest('hex'));
    if(check.diffSha256)assert.equal(check.diffSha256,row.diffSha256);
    decision.baseIndependentSuccess=decision.independentSuccess;
    decision.registeredSemanticDiagnostic={artifact:file,sourceSha256:check.sourceSha256,passed:check.passed};
    decision.independentSuccess&&=check.passed;
    decision.auditedCompletion=decision.independentSuccess&&row.status==='succeeded';
  }
  await writeFile(join(root,file),JSON.stringify(replay,null,2)+'\n');
}
audit.endpoint='T3 preregistered audited instruction criteria including known extended Unicode marks and valid-percent key, AND successful runtime completion. Official score and base adjudication preserved separately.';
audit.semanticRegistration={registeredAt:protocol.registeredAt,protocolSha256:createHash('sha256').update(protocolBytes).digest('hex')};
await writeFile(join(root,'adjudication.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({decisions:audit.decisions.length,semanticRegistration:audit.semanticRegistration}));
