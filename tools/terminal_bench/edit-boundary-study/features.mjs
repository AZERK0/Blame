// Private finite confirmation probes,run after a clean source build.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {study} from './paths.mjs';
const root=resolve(process.argv[2]),id=process.argv[3],p=JSON.parse(await readFile(join(study,'protocol.json'))),task=p.tasks.find(t=>t.id===id),checks=[];
for(const [path,text]of Object.entries(task.inputFiles)){
 const bytes=await readFile(join(root,path)).catch(()=>Buffer.from('<missing>'));
 checks.push({name:'protected-input:'+path,passed:bytes.equals(Buffer.from(text))});
}
const yaml=String.raw`
const assert=require('node:assert/strict'),Y=require('./dist');
const checks=[];function check(name,fn){try{fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
check('anchor on mapping key',()=>{const text='? &key one\n: two\n',d=Y.parseDocument(text),n=d.contents.items[0].key;assert.deepEqual(n.anchorRange,[2,6]);assert.equal(n.anchor,'key');});
check('two documents have absolute input offsets',()=>{const text='---\na: &x 1\n---\nb: &x 2\n',ds=Y.parseAllDocuments(text);assert.deepEqual(ds.map(d=>d.get(d===ds[0]?'a':'b',true).anchorRange),[[text.indexOf('&x'),text.indexOf('&x')+2],[text.lastIndexOf('&x'),text.lastIndexOf('&x')+2]]);});
check('root anchored empty node at eof',()=>{const d=Y.parseDocument('&last');assert.deepEqual(d.contents.anchorRange,[0,5]);assert.equal(d.contents.value,null);});
check('document clone has independent tuples',()=>{const d=Y.parseDocument('a: &x [1,2]\n'),c=d.clone();assert.deepEqual(c.get('a',true).anchorRange,[3,5]);assert.notEqual(c.get('a',true).anchorRange,d.get('a',true).anchorRange);});
check('parse errors for empty anchors stay visible',()=>{const d=Y.parseDocument('a: & value\n');assert(d.errors.some(e=>e.code==='BAD_ALIAS'));});
process.stdout.write(JSON.stringify(checks));`;
const glob=String.raw`
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),fg=require('./out');
const checks=[];async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}}
(async()=>{const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'f31-extra-'));try{
for(const n of ['yes/a.txt','no/b.txt','root.txt']){fs.mkdirSync(path.dirname(path.join(cwd,n)),{recursive:true});fs.writeFileSync(path.join(cwd,n),'x');}
await check('false callback includes nothing in all modes',async()=>{assert.deepEqual(fg.sync('**/*',{cwd,filter:()=>false}),[]);assert.deepEqual(await fg('**/*',{cwd,filter:()=>false}),[]);});
await check('onlyDirectories still filters and descends',()=>{assert.deepEqual(fg.sync('**/*',{cwd,onlyDirectories:true,filter:e=>e.path!=='no'}),['yes']);});
await check('absolute outputs retain original callback paths',()=>{const seen=[];const a=fg.sync('yes/*',{cwd,absolute:true,filter:e=>{seen.push(e.path);return true;}});assert.deepEqual(a,[path.join(cwd,'yes/a.txt')]);assert(seen.includes('yes/a.txt'));assert(seen.every(x=>!path.isAbsolute(x)));});
await check('depth and ignore remain binding',()=>{const a=fg.sync('**/*',{cwd,deep:1,ignore:['root.txt'],filter:()=>true});assert.deepEqual(a,[]);});
await check('existing adapters and uniqueness retained',()=>{const a=fg.sync(['yes/*','yes/a.txt'],{cwd,filter:()=>true,unique:true});assert.deepEqual(a,['yes/a.txt']);});
}finally{fs.rmSync(cwd,{recursive:true,force:true});}process.stdout.write(JSON.stringify(checks));})().catch(e=>{throw e;});`;
const r=spawnSync(process.execPath,['--input-type=commonjs','-e',id==='yaml-anchor-ranges'?yaml:glob],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
try{checks.push(...JSON.parse(r.stdout));}catch{checks.push({name:'probe execution',passed:false,error:r.stderr.slice(0,500)});}
if(r.status!==0)checks.push({name:'probe exit',passed:false});
const s=createHash('sha256').update(checks.map(c=>c.name).join('\n')).digest('hex');
console.log(JSON.stringify({checks,checkNamesSha256:s}));process.exitCode=checks.every(c=>c.passed)?0:1;
