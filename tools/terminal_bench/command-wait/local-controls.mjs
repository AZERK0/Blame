// Untimed local policy controls. No model tokens or task-success inference.
import assert from "node:assert/strict";
import { mkdtemp,mkdir,access,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { LightWorkspace } from "../../../packages/agent-runtime/dist/harness/light-workspace.js";
const repo=resolve(new URL("../../..",import.meta.url).pathname);
const quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
const command=code=>`${quote(process.execPath)} -e ${quote(code)}`;
const observations=[];
await Promise.all([5000,15000].map(async wait=>{
 const root=await mkdtemp(join(tmpdir(),"blame-command-wait-"));
 const workspace=new LightWorkspace(root,{sessionId:String(wait),initialCommandWaitMs:wait});
 const run=async(code,context={})=>{const start=performance.now();const result=await workspace.runTask({kind:"command",command:command(code)},context);return {result,durationMs:performance.now()-start};};
 const fast=await run('process.stdout.write("fast")');assert.equal(fast.result.status,"ok");assert.equal(fast.result.data.exitCode,0);assert.ok(fast.durationMs<3000);
 const slow=await run('process.stdout.write("ready\\n");setTimeout(()=>process.stdout.write("done\\n"),6000)');
 assert.equal(slow.result.status,"ok");
 if(wait===5000){assert.equal(slow.result.data.process,"running");await new Promise(r=>setTimeout(r,1300));const last=await workspace.runTask({kind:"inspect",run:slow.result.data.run,cursor:slow.result.data.cursor});assert.equal(last.data.process,"exited");assert.equal(last.data.completed.data.exitCode,0);slow.final=last;slow.backendCalls=2;}
 else{assert.equal(slow.result.data.exitCode,0);assert.equal(slow.result.data.run,undefined);slow.backendCalls=1;}
 const nonzero=await run('console.error("controlled nonzero");process.exit(7)');assert.equal(nonzero.result.status,"blocked");assert.match(nonzero.result.message,/7/u);
 const controller=new AbortController();await mkdir(join(root,".blame"),{recursive:true});
 const cancelStart=performance.now();const pending=run('require("node:fs").writeFileSync(".blame/ready","yes");setInterval(()=>{},1000)',{signal:controller.signal});
 while(true){try{await access(join(root,".blame/ready"));break;}catch{if(performance.now()-cancelStart>3000)throw new Error("Child did not start");await new Promise(r=>setTimeout(r,20));}}
 const aborted=performance.now();controller.abort();const cancelled=await pending;const cancelLatencyMs=performance.now()-aborted;
 assert.notEqual(cancelled.result.status,"ok");assert.ok(cancelLatencyMs<1500);
 const longController=new AbortController();const long=await run('process.stdout.write("long ready\\n");setTimeout(()=>{},20000)',{signal:longController.signal});
 assert.equal(long.result.status,"ok");assert.equal(long.result.data.process,"running");assert.ok(long.durationMs>=wait-100);longController.abort();await new Promise(r=>setTimeout(r,300));
 const longFinal=await workspace.runTask({kind:"inspect",run:long.result.data.run,cursor:long.result.data.cursor});assert.equal(longFinal.data.process,"cancelled");
 observations.push({waitMs:wait,root,fast,slow,nonzero,cancelled,cancelLatencyMs,long,longFinal});
}));
const study=join(repo,"docs/experiments/light-harness-command-wait-2026-10-12");
await writeFile(join(study,"local-controls.json"),JSON.stringify({method:"Real subprocesses through LightWorkspace using the already available explicit wait override, before changing the production default. Two policies; fast/6-second/nonzero/cancel/20-second running controls. Calls are backend calls, never model tokens or measured model efficiency. Timing and scheduler/cache state uncontrolled.",observations},null,2)+"\n");
console.log(JSON.stringify({policies:2,controls:10,slowBackendCalls:observations.map(v=>[v.waitMs,v.slow.backendCalls]),cancelLatencyMs:observations.map(v=>v.cancelLatencyMs)}));
