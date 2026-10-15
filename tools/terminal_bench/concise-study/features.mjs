// Independent preregistered behavior/type probes. Never fed back to model runs.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {repo,study,work} from './paths.mjs';
const [root,id]=process.argv.slice(2),protocol=JSON.parse(await readFile(join(study,'protocol.json')));
const task=protocol.tasks.find(t=>t.id===id);assert(task);
const require=createRequire(import.meta.url),api=require(join(resolve(root),'index.js'));
const {Command,Option,Argument,Help,InvalidArgumentError}=api,checks=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const check=(name,fn)=>{try{fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:e.message});}};
const quiet=()=>new Command().exitOverride().configureOutput({writeOut(){},writeErr(){}});
for(const [path,text] of Object.entries(task.inputFiles))check('protected-input:'+path,()=>assert.equal(require('node:fs').readFileSync(join(root,path),'utf8'),text));
const before=Object.fromEntries(await Promise.all(task.allowedPaths.map(async p=>[p,sha(await readFile(join(root,p)))])));
if(task.kind==='choices'){
 for(const [label,make] of [['option',variadic=>new Option(variadic?'--size <size...>':'--size <size>')],['argument',variadic=>new Argument(variadic?'<size...>':'<size>')]]){
  check(label+':canonical-first-copied-and-empty',()=>{
   const choices=['MiXeD','UPPER','mixed',''],target=make(false).choices(choices,{caseInsensitive:true});choices.splice(0,4,'other');
   for(const [value,want] of [['mixed','MiXeD'],['MIXED','MiXeD'],['upper','UPPER'],['','']])assert.equal(target.parseArg(value),want);
   assert.throws(()=>target.parseArg('absent'),e=>e instanceof InvalidArgumentError&&e.message.includes('MiXeD'));
   assert.throws(()=>make(false).choices([],{caseInsensitive:true}).parseArg(''),e=>e instanceof InvalidArgumentError);
  });
  check(label+':nontrue-default-differential',()=>{
   for(const config of [undefined,null,false,{}, {caseInsensitive:false},{caseInsensitive:0},{caseInsensitive:'true'}]){
    const target=make(false).choices(['MiXeD'],config);assert.equal(target.parseArg('MiXeD'),'MiXeD');
    assert.throws(()=>target.parseArg('mixed'),e=>e instanceof InvalidArgumentError);
   }
  });
  check(label+':variadic-hook-and-exception-identity',()=>{
   const target=make(true).choices(['MiXeD'],{caseInsensitive:true}),prior=['before'],token={};let count=0;
   target._concatValue=(value,previous)=>{count++;assert.equal(value,'MiXeD');assert.equal(previous,prior);return token;};
   assert.equal(target.parseArg('mixed',prior),token);assert.equal(count,1);
   const sentinel=new Error('concat');target._concatValue=()=>{throw sentinel;};assert.throws(()=>target.parseArg('MIXED',prior),e=>e===sentinel);
  });
  check(label+':parser-replacement-order-and-fluent-subclass',()=>{
   const target=make(false),sentinel=new Error('custom');target.choices(['MiXeD'],{caseInsensitive:true}).argParser(()=>{throw sentinel;});
   assert.throws(()=>target.parseArg('anything'),e=>e===sentinel);
   target.choices(['MiXeD'],{caseInsensitive:true});assert.equal(target.parseArg('MIXED'),'MiXeD');
  });
 }
 check('choices:parse-error-hook-and-default-array',()=>{
  const sentinel=new Error('parser');const c=quiet().addOption(new Option('--value <value>').choices(['One'],{caseInsensitive:true}).argParser(()=>{throw sentinel;}));
  assert.throws(()=>c.parse(['--value','one'],{from:'user'}),e=>e===sentinel);
  const defaults=['DEFAULT'];const arg=new Argument('<value...>').default(defaults).choices(['One'],{caseInsensitive:true});assert.deepEqual(arg.parseArg('ONE',defaults),['One']);assert.deepEqual(defaults,['DEFAULT']);
 });
}else if(task.kind==='hidden-arguments'){
 check('hidden:unconfigured-enumeration-shape',()=>{const original=require(join(repo,protocol.upstreams.commander.sourceRoot,'index.js'));assert.deepEqual(Object.keys(new Argument('<x>')),Object.keys(new original.Argument('<x>')));});
 check('hidden:default-coercion-and-reversal',()=>{const a=new Argument('[x]');assert.equal(a.hidden,false);for(const flag of [true,1,'yes',false,0,'']){assert.equal(a.hideHelp(flag),a);assert.equal(a.hidden,!!flag);}});
 check('hidden:description-table-gate-after-filter',()=>{
  const command=quiet().addArgument(new Argument('<secret>','secret detail').hideHelp()).argument('[ordinary]');
  const args=command.registeredArguments.slice(),helper=new Help();assert.deepEqual(helper.visibleArguments(command),[]);
  command.description('',{ordinary:'visible legacy'});assert.deepEqual(helper.visibleArguments(command),[args[1]]);assert.equal(args[1].description,'visible legacy');
  assert.deepEqual(command.registeredArguments,args);args[0].hideHelp(false);assert.deepEqual(helper.visibleArguments(command),args);
 });
 check('hidden:callbacks-identity-and-throws',()=>{
  const sentinel=new Error('argument-hook');let calls=0;const arg=new Argument('<secret>').hideHelp().argParser(()=>{calls++;throw sentinel;});
  assert.throws(()=>quiet().addArgument(arg).parse(['value'],{from:'user'}),e=>e===sentinel);assert.equal(calls,1);
  const c=quiet().addArgument(new Argument('[secret]').default('fallback').hideHelp());let received;c.action(v=>received=v);c.parse([],{from:'user'});assert.equal(received,'fallback');
 });
 check('hidden:required-variadic-usage-and-nonmutation',()=>{
  const c=quiet().addArgument(new Argument('<secrets...>','SECRET-DESCRIPTION').hideHelp());assert(c.helpInformation().includes('<secrets...>'));assert(!c.helpInformation().includes('SECRET-DESCRIPTION'));
  c.parse(['a','b'],{from:'user'});assert.deepEqual(c.processedArgs,[['a','b']]);assert.equal(c.registeredArguments.length,1);
  assert.throws(()=>quiet().addArgument(new Argument('<x>').hideHelp()).parse([],{from:'user'}),e=>e.code==='commander.missingArgument');
 });
}else if(task.kind==='env-fallback'){
 const keys=['F30_PRIVATE_A','F30_PRIVATE_B','F30_PRIVATE_C'];
 const withEnv=(values,run)=>{const saved=keys.map(k=>process.env[k]);try{keys.forEach((k,i)=>values[i]===undefined?delete process.env[k]:process.env[k]=values[i]);return run();}finally{keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}};
 const opt=(flags='--mode <mode>')=>new Option(flags).env(keys[0],[keys[1],keys[2]]);
 check('env:defined-order-and-replacement-snapshot',()=>{
  for(const [values,want] of [[[undefined,'second','third'],'second'],[['','second','third'],''],[[undefined,undefined,'third'],'third'],[['first','second','third'],'first']])withEnv(values,()=>{const c=quiet().addOption(opt());c.parse([],{from:'user'});assert.equal(c.opts().mode,want);assert.equal(c.getOptionValueSource('mode'),'env');});
  withEnv([undefined,'second','third'],()=>{const list=[keys[1]],o=new Option('--mode <mode>').env(keys[0],list);list[0]=keys[2];const c=quiet().addOption(o);c.parse([],{from:'user'});assert.equal(c.opts().mode,'second');o.env(keys[0],[]);const reset=quiet().addOption(o);reset.parse([],{from:'user'});assert.equal(reset.opts().mode,undefined);assert.equal(o.envVar,keys[0]);});
 });
 check('env:precedence-and-call-counts',()=>withEnv([undefined,'second','third'],()=>{
  for(const [source,want,calls] of [['config','SECOND',1],['default','SECOND',1],['env','SECOND',1],['cli','old',0],[undefined,'old',0]]){
   let count=0;const c=quiet().addOption(opt().argParser(v=>{count++;return v.toUpperCase();}));c.setOptionValueWithSource('mode','old',source);c.parse([],{from:'user'});assert.equal(c.opts().mode,want);assert.equal(count,calls);
  }
 }));
 check('env:real-source-error-and-sentinel',()=>withEnv([undefined,undefined,'invalid'],()=>{
  assert.throws(()=>quiet().addOption(opt().choices(['good'])).parse([],{from:'user'}),e=>e.code==='commander.invalidArgument'&&e.message.includes(keys[2])&&!e.message.includes("from env '"+keys[0]+"'"));
  let count=0;const sentinel=new Error('env-hook');assert.throws(()=>quiet().addOption(opt().argParser(()=>{count++;throw sentinel;})).parse([],{from:'user'}),e=>e===sentinel);assert.equal(count,1);
 }));
 check('env:public-event-argument-contract',()=>withEnv([undefined,'event-value',undefined],()=>{
  for(const flags of ['--mode <mode>','--mode [mode]','--mode']){const c=quiet().addOption(opt(flags)),calls=[];c.on('optionEnv:mode',(...args)=>calls.push(args));c.parse([],{from:'user'});assert.deepEqual(calls,[flags==='--mode'?[]:['event-value']]);}
 }));
 check('env:boolean-negation-optional-variadic-and-help',()=>withEnv([undefined,'',undefined],()=>{
  for(const [flags,key,want] of [['--active','active',true],['--no-active','active',false],['--mode [mode]','mode',''],['--mode <mode...>','mode',['']]]){const c=quiet().addOption(opt(flags));c.parse([],{from:'user'});assert.deepEqual(c.opts()[key],want);}
  const o=opt(),helper=new Help();assert(helper.optionDescription(o).includes('env: '+keys.join(', ')));o.env(keys[0]);assert(!helper.optionDescription(o).includes(keys[1]));
 }));
}else throw Error('Unknown kind');
// Compile independent readonly/subclass inputs and deliberately invalid calls.
const temporary=await mkdtemp(join(work,'type-probe-'));
try{
 const lines=['import {Option,Argument} from '+JSON.stringify(join(resolve(root),'typings/index.js'))+';','class CustomOption extends Option { custom(){return this;} }','class CustomArgument extends Argument { custom(){return this;} }'];
 if(task.kind==='choices')lines.push('const choices=["One","Two"] as const;new CustomOption("--x <x>").choices(choices,{caseInsensitive:true}).custom();new CustomArgument("<x>").choices(choices,{caseInsensitive:true}).custom();','// @ts-expect-error invalid option flag type','new Option("--x <x>").choices(choices,{caseInsensitive:"true"});','// @ts-expect-error invalid argument flag type','new Argument("<x>").choices(choices,{caseInsensitive:"true"});','// @ts-expect-error argument choices stay strings','new Argument("<x>").choices([1],{caseInsensitive:true});','// @ts-expect-error option choices stay strings','new Option("--x <x>").choices([1],{caseInsensitive:true});');
 if(task.kind==='hidden-arguments')lines.push('const hidden:boolean=new CustomArgument("<x>").hideHelp(false).custom().hidden;','// @ts-expect-error hide parameter stays boolean','new Argument("<x>").hideHelp("true");');
 if(task.kind==='env-fallback')lines.push('const names=["BACKUP","LAST"] as const;new CustomOption("--x <x>").env("FIRST",names).custom();const primary:string|undefined=new Option("--x").env("FIRST",names).envVar;','// @ts-expect-error names remain strings','new Option("--x").env("FIRST",[1]);','// @ts-expect-error primary remains string','new Option("--x").env(["FIRST"]);');
 const file=join(temporary,'contract.ts');await writeFile(file,lines.join('\n')+'\n');
 const compiler=join(repo,protocol.upstreams.commander.sourceRoot,'node_modules/typescript/bin/tsc');
 const r=spawnSync(process.execPath,[compiler,'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','Node16','--moduleResolution','Node16','--types','node','--typeRoots',join(repo,protocol.upstreams.commander.sourceRoot,'node_modules/@types'),file],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
 check('public-types:readonly-fluent-and-reject-invalid',()=>assert.equal(r.status,0,(r.stdout??'')+(r.stderr??'')));
}finally{await rm(temporary,{recursive:true,force:true});}
for(const path of task.allowedPaths)check('read-only-probe:'+path,()=>assert.equal(sha(require('node:fs').readFileSync(join(root,path))),before[path]));
console.log(JSON.stringify({checks}));if(checks.some(c=>!c.passed))process.exitCode=1;
