// Replay the two observed insertion shapes against unchanged RxJS input source.
// These are zero-model copies; no paid workspace is modified or rescored.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [dist,expectation]=process.argv.slice(2);
assert(['before','after'].includes(expectation),'Pass runtime/dist and before|after');
const {LightWorkspace}=await import(pathToFileURL(join(resolve(dist),'harness/light-workspace.js')));
const sourcePath='.blame/research/native-confirmation/rxjs/src/internal/types.ts';
const source=await readFile(sourcePath,'utf8');
const sha=s=>createHash('sha256').update(s).digest('hex');
const declaration=source.indexOf('interface ReadableStreamDefaultReaderLike<T>');assert(declaration>=0);
const content='  cancel?(): PromiseLike<void>;',rows=[];
for(const [member,terminator] of [['read','  >;'],['releaseLock','  releaseLock(): void;']]){
 const root=await mkdtemp(join(tmpdir(),'blame-member-boundary-'));
 try{
  await writeFile(join(root,'types.ts'),source);
  const workspace=new LightWorkspace(root,{sessionId:'member-boundary-'+member});
  assert.equal((await workspace.readCode({target:'types.ts',view:'raw'},{})).status,'ok');
  const result=await workspace.editCode({operations:[{kind:'symbol',target:'types.ts#ReadableStreamDefaultReaderLike.'+member,action:'insert_after',content}]});
  const final=await readFile(join(root,'types.ts'),'utf8');
  if(expectation==='before'){
   assert.equal(result.status,'blocked');assert.match(result.message,/Final parse failed/);assert.equal(final,source);
  }else{
   assert.equal(result.status,'ok',JSON.stringify(result));
   const at=source.indexOf(terminator,declaration)+terminator.length;assert(at>declaration);
   assert.equal(final,source.slice(0,at)+content+source.slice(at));
  }
  rows.push({member,input:{action:'insert_after',content},result,originalSha256:sha(source),finalSha256:sha(final),originalBytes:Buffer.byteLength(source),finalBytes:Buffer.byteLength(final),unchanged:final===source});
 }finally{await rm(root,{recursive:true,force:true});}
}
process.stdout.write(JSON.stringify({paidRequests:0,expectation,sourcePath,rows},null,2)+'\n');
