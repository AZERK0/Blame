const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const fg=require('../out');
const collect=stream=>new Promise((resolve,reject)=>{const items=[];stream.on('data',x=>items.push(x));stream.on('error',reject);stream.on('end',()=>resolve(items));});
module.exports=function register(test){
 async function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'f31-glob-'));try{
  for(const name of ['keep/a.txt','keep/b.js','blocked/deep/secret.txt','root.txt','.dot.txt']){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),'x');}
  await fn(root);
 }finally{fs.rmSync(root,{recursive:true,force:true});}}
 for(const mode of ['sync','async','stream']){
  const run=(patterns,options)=>mode==='sync'?fg.sync(patterns,options):mode==='async'?fg(patterns,options):collect(fg.stream(patterns,options));
  test(mode+' filters files and prunes directories despite onlyFiles',()=>fixture(async cwd=>{
   const visited=[],reads=[],adapter={};
   for(const name of ['readdir','readdirSync'])adapter[name]=function(p,...args){reads.push(path.relative(cwd,p));return fs[name](p,...args);};
   const filter=entry=>{assert.ok(entry.dirent);visited.push(entry.path);return entry.path!=='blocked'&&!entry.path.endsWith('.js');};
   const actual=await run('**/*',{cwd,filter,fs:adapter});
   assert.deepEqual(actual.sort(),['keep/a.txt','root.txt']);
   assert.ok(visited.includes('blocked'));assert.equal(reads.some(p=>p==='blocked'||p.startsWith('blocked/')),false);
  }));
  test(mode+' filters static paths and object output',()=>fixture(async cwd=>{
   const actual=await run(['keep/a.txt','keep/b.js'],{cwd,objectMode:true,filter:e=>e.path.endsWith('.txt')});
   assert.deepEqual(actual.map(e=>e.path),['keep/a.txt']);assert.equal(actual[0].dirent.isFile(),true);
  }));
  test(mode+' keeps existing ignores and defaults',()=>fixture(async cwd=>{
   const original=await run('**/*',{cwd,ignore:['blocked/**']});
   const filtered=await run('**/*',{cwd,ignore:['blocked/**'],filter:()=>true});
   assert.deepEqual(filtered.sort(),original.sort());assert.equal(filtered.includes('.dot.txt'),false);
  }));
  test(mode+' preserves callback error identity',()=>fixture(async cwd=>{
   const sentinel=new Error('f31 callback');let caught;
   try{await run('**/*',{cwd,filter:()=>{throw sentinel;}});}catch(e){caught=e;}
   assert.equal(caught,sentinel);
  }));
 }
};
