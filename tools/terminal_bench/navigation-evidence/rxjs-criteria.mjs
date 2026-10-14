// Independent behavior probes; no source patch or feedback reaches models.
import {createRequire} from "node:module";
import {join} from "node:path";
import vm from "node:vm";
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function auditRxjsLifecycle(workspace) {
  const require=createRequire(join(workspace,"package.json")),esbuild=require("esbuild");
  const code=esbuild.buildSync({stdin:{contents:'export {firstValueFrom, scheduled, from, asyncScheduler, take} from "./src/index"; export {readableStreamLikeToAsyncGenerator} from "./src/internal/util/isReadableStreamLike";',resolveDir:workspace},bundle:true,platform:"node",format:"cjs",write:false,logLevel:"silent"}).outputFiles[0].text;
  const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require,setTimeout,clearTimeout,setInterval,clearInterval,Promise,console});
  const rx=module.exports,checks=[],unhandled=[],onUnhandled=e=>unhandled.push(String(e));
  process.on("unhandledRejection",onUnhandled);
  const reader=(rejectCancel=false)=>{
    const state={reads:0,cancels:0,releases:0};
    return {state,stream:{getReader:()=>({read:async()=>({done:false,value:++state.reads}),cancel:async()=>{state.cancels++;if(rejectCancel)throw Error("cancel rejected");},releaseLock:()=>{state.releases++;}})}};
  };
  try {
    const a=reader(),iterator=rx.readableStreamLikeToAsyncGenerator(a.stream);await iterator.next();await iterator.return();
    checks.push({name:"generator-early-cancel-once-and-release",passed:a.state.cancels===1&&a.state.releases===1});
    const b=reader(true),rejecting=rx.readableStreamLikeToAsyncGenerator(b.stream);await rejecting.next();let rejected=false;
    try{await rejecting.return();}catch{rejected=true;}
    checks.push({name:"release-even-when-cancel-rejects",passed:rejected&&b.state.cancels===1&&b.state.releases===1});
    let naturalCanceled=0,naturalReleased=0;
    const natural=rx.readableStreamLikeToAsyncGenerator({getReader:()=>({read:async()=>({done:true}),cancel:async()=>naturalCanceled++,releaseLock:()=>naturalReleased++})});await natural.next();
    checks.push({name:"natural-completion-releases-without-cancel",passed:naturalCanceled===0&&naturalReleased===1});
    let oldReleased=0,oldCompatible=true;
    const older=rx.readableStreamLikeToAsyncGenerator({getReader:()=>({read:async()=>({done:false,value:1}),releaseLock:()=>oldReleased++})});
    await older.next();try{await older.return();}catch{oldCompatible=false;}
    checks.push({name:"older-reader-without-cancel-remains-compatible",passed:oldCompatible&&oldReleased===1});
    for(const scheduled of [false,true]) {
      const c=reader();await rx.firstValueFrom(scheduled?rx.scheduled(c.stream,rx.asyncScheduler):rx.from(c.stream));await delay(20);
      checks.push({name:`${scheduled?"scheduled":"unscheduled"}-stream-take-one-cleanup`,passed:c.state.cancels===1&&c.state.releases===1});
    }
    const state={active:0,max:0,pulls:0,returns:0};
    const iterable={[Symbol.asyncIterator]:()=>({next:()=>{state.pulls++;const value=state.pulls;state.active++;state.max=Math.max(state.max,state.active);return delay(10).then(()=>{state.active--;return {done:false,value};});},return:async()=>{state.returns++;return {done:true};}})};
    await new Promise((resolve,reject)=>{let subscription;const timer=setTimeout(()=>{subscription?.unsubscribe();reject(Error("lifecycle probe timed out"));},500);
      subscription=rx.scheduled(iterable,rx.asyncScheduler).pipe(rx.take(2)).subscribe({complete:()=>{clearTimeout(timer);resolve();},error:reject});});await delay(25);
    checks.push({name:"scheduled-single-flight-and-exactly-once-return",passed:state.max===1&&state.pulls===2&&state.returns===1,observed:state});
    let observedError=false;
    const errors={[Symbol.asyncIterator]:()=>({next:()=>Promise.reject(Error("expected next failure")),return:async()=>({done:true})})};
    const subscription=rx.scheduled(errors,rx.asyncScheduler).subscribe({error:e=>{observedError=e.message==="expected next failure";}});
    await delay(20);subscription.unsubscribe();await delay(5);
    checks.push({name:"scheduled-next-rejection-notifies-subscriber",passed:observedError});
    checks.push({name:"no-unhandled-promise-rejection",passed:unhandled.length===0,observed:unhandled});
    return checks;
  } finally {process.off("unhandledRejection",onUnhandled);}
}
