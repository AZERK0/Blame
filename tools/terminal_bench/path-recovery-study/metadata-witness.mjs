// Uniform post-hoc audit of extra website metadata; no model calls or source repair.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {work,study,dependencyRoot,json,save,sha} from './setup.mjs';
import {work as inputWork} from '../confirmation-study/setup.mjs';
const startedAtUTC=new Date().toISOString();
const prefix='valibot-63dfa76dbf4f78144398815015947a7cc4d12c4b';
const upstream=join(inputWork,'upstream/valibot.tar.gz');
const extract=(archive,prefix,path)=>execFileSync('tar',['-xOf',archive,prefix+'/'+path],{encoding:'utf8'});
const componentPath='website/src/components/Property.tsx',component=extract(upstream,prefix,componentPath);
const schema=component.slice(component.indexOf('type DefinitionData ='),component.indexOf('/**'));
assert.ok(schema.includes('export type PropertyProps')&&schema.includes('value: boolean;'));
const paths=['website/src/routes/api/(types)/Config/properties.ts','website/src/routes/api/(methods)/fallback/properties.ts','website/src/routes/api/(async)/fallbackAsync/properties.ts'];
const originalHashes=Object.fromEntries(paths.map(path=>[path,sha(extract(upstream,prefix,path))]));
const analysis=await json(join(work,'campaign/analysis.json')),protocol=await json(join(study,'protocol.json'));
assert.equal(analysis.rows.length,protocol.order.length);
const records=[];
for(const row of [null,...analysis.rows]){
 const name=row?.name??'original',root=join(work,'metadata-witness',name);await mkdir(root,{recursive:true});
 const archive=row?join(work,'campaign',name,'workspace.tar.gz'):upstream;
 if(row)assert.equal(sha(await readFile(archive)),(await json(join(work,'campaign',name,'workspace-archive.json'))).sha256);
 const grade=row?await json(join(work,'campaign',name,'score.json')):null;
 const sourceHashes={},changed=[];
 for(const[index,path]of paths.entries()){
  const text=extract(archive,row?'workspace':prefix,path);sourceHashes[path]=sha(text);
  assert.equal(sourceHashes[path],grade?.sourceHashes[path]??originalHashes[path]);
  if(sourceHashes[path]!==originalHashes[path])changed.push(path);
  const input=text.replace(/from ['"]~\/components['"]/,'from "./schema.js"');assert.notEqual(text,input);
  await writeFile(join(root,`metadata-${index}.ts`),input);
 }
 const componentChanged=sha(extract(archive,row?'workspace':prefix,componentPath))!==sha(component);
 await writeFile(join(root,'schema.ts'),schema);
 const args=[join(dependencyRoot,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','ESNext','--moduleResolution','Bundler','--target','ES2022','schema.ts',...paths.map((_,i)=>`metadata-${i}.ts`)];
 const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:30000});
 records.push({name,hashes:row?.hashes??null,sourceHashes,changed,componentChanged,exitCode:result.status,signal:result.signal,error:result.error?.code??null,stdout:result.stdout,stderr:result.stderr});
 await rm(root,{recursive:true});console.log(name,result.status);
}
assert.equal(records[0].exitCode,0);
await save(join(study,'metadata-witness.json'),{startedAtUTC,endedAtUTC:new Date().toISOString(),modelRequests:0,complete:true,
 method:'Uniform isolated audit of three original website metadata modules on every unchanged endpoint, prompted by the known F42 extra-documentation type failure and F43 trial4 adding Config documentation outside selected compiler scope. Use exact original DefinitionData/PropertyProps and replace only the type-import path. An altered component schema requires manual review. This is not a full website build, changed official check or repaired agent solution.',
 originalComponentSha256:sha(component),extractedSchemaSha256:sha(schema),schema,paths,records});
