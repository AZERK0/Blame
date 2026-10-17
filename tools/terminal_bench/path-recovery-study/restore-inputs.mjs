// Restore public endpoint-replay inputs only. Never launches a model or overwrites a campaign.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {work,study,dependencyRoot,json,sha,save} from './setup.mjs';
import {work as inputWork} from '../confirmation-study/setup.mjs';
async function retain(path,bytes){
 const existing=await readFile(path).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
 if(existing)assert.equal(sha(existing),sha(bytes),'Refusing to replace different input: '+path);
 else await writeFile(path,bytes,{flag:'wx'});
}
const campaignStarted=await readFile(join(work,'campaign/provenance.json')).then(()=>true,()=>false);
if(campaignStarted){const exit=await json(join(work,'campaign/driver-exit.json')).catch(()=>null);assert.equal(exit?.complete,true,'Do not restore inputs while a campaign is active or unfinished');}
await mkdir(join(inputWork,'upstream'),{recursive:true});
const archives=await json(join(study,'input-archives.json'));
for(const name of ['valibot.tar.gz']){
 const bytes=await readFile(join(study,'inputs',name));assert.equal(sha(bytes),archives.artifacts[name]);
 await retain(join(inputWork,'upstream',name),bytes);
}
const root=dependencyRoot,lockBytes=await readFile(join(study,'dependency-package-lock.json')),lock=JSON.parse(lockBytes);
assert.equal(sha(lockBytes),(await json(join(study,'protocol.json'))).execution.dependencyLockSha256);
await mkdir(root,{recursive:true});await retain(join(root,'package-lock.json'),lockBytes);
const packagePath=join(root,'package.json'),manifest={name:lock.name,private:true,type:'module',dependencies:lock.packages[''].dependencies};
const existing=await readFile(packagePath).then(JSON.parse,e=>{if(e.code!=='ENOENT')throw e;return null;});
if(existing)assert.deepEqual(existing.dependencies,manifest.dependencies);else await save(packagePath,manifest);
const installed=await lstat(join(root,'node_modules')).then(()=>true,e=>{if(e.code!=='ENOENT')throw e;return false;});
if(!installed){
 assert.ok(process.argv.includes('--install'),'Pinned dependency installation is missing. Re-run with --install to run npm ci.');
 const p=spawnSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:root,stdio:'inherit',env:{...process.env,npm_config_update_notifier:'false'}});assert.equal(p.status,0);
}
const checks=[];
for(const[name,version]of Object.entries(manifest.dependencies)){
 const actual=await json(join(root,'node_modules',name,'package.json'));assert.equal(actual.version,version);checks.push({name,version});
}
console.log(JSON.stringify({modelRequests:0,upstreamArchivesVerified:true,dependencies:checks,
 next:'Run verify.mjs on the published ledger, then replay.mjs --output=/absolute/new-result.json. Model reruns require a separately registered campaign and environment; this helper does not reproduce provider randomness or invoices.'}));
