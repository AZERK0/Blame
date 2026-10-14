// Research-only load-time repair. Installed SDK bytes and all Light trials stay untouched.
import {registerHooks} from "node:module";
import {createHash} from "node:crypto";
import {appendFileSync,readFileSync} from "node:fs";
const sha=s=>createHash("sha256").update(s).digest("hex");
export function repairSearchSource(source) {
  const marker=source.indexOf('"rg",["--json",');
  if(marker<0)return null;
  const start=source.lastIndexOf("function ",marker),end=source.indexOf("function ",marker);
  if(start<0||end<0)throw Error("SDK search function boundary missing");
  const old=source.slice(start,end),name=/^function ([\w$]+)\(/u.exec(old)?.[1];
  const spawn=/let [\w$]+=([\w$]+)\("rg",/u.exec(old)?.[1];
  const cap=/[\w$]+\.length>([\w$]+)/u.exec(old)?.[1];
  if(!name||!spawn||!cap||!old.includes('"--max-count=1"'))throw Error("SDK search fingerprint changed");
  const replacement=`function ${name}(pattern,cwd,limit,context,timeout=5000,signal){return new Promise(resolve=>{
    const child=${spawn}("rg",["--json","--context="+context,"-i","--",pattern,"."],{cwd,stdio:["ignore","pipe","pipe"],windowsHide:true});
    let bytes="",settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);if(!child.killed)child.kill("SIGTERM");resolve(value);};
    const abort=()=>finish(null),timer=setTimeout(abort,timeout);
    if(signal?.aborted){abort();return;}signal?.addEventListener("abort",abort,{once:true});
    child.stdout.on("data",chunk=>{bytes+=chunk.toString();if(bytes.length>${cap})finish(null);});child.stderr.on("data",()=>{});
    child.on("error",abort);child.on("close",code=>{
      if(settled)return;if(code!==0&&code!==1){finish(null);return;}
      try{
        const records=bytes.trim().split("\\n").filter(Boolean).map(JSON.parse),lines=new Map(),matches=[];
        for(const record of records){const d=record.data;if(!["match","context"].includes(record.type)||!d?.path?.text)continue;
          const file=d.path.text.replace(/^\\.\\//,""),line=d.line_number,text=(d.lines?.text??d.line?.text??"").replace(/\\r?\\n$/,""),key=file+"\\0"+line;
          lines.set(key,text);if(record.type==="match"&&matches.length<limit)matches.push({file,line,column:(d.submatches?.[0]?.start??0)+1,match:d.submatches?.[0]?.match?.text??"",context:[]});
        }
        for(const match of matches)for(let line=Math.max(1,match.line-context);line<=match.line+context;line++){
          const key=match.file+"\\0"+line;if(lines.has(key))match.context.push((line===match.line?">":" ")+" "+line+": "+lines.get(key));
        }
        finish(matches.length?matches:null);
      }catch{finish(null);}
    });
  })}`;
  return {source:source.slice(0,start)+replacement+source.slice(end),functionName:name,
    originalFunctionSha256:sha(old),replacementFunctionSha256:sha(replacement)};
}
if(process.env.BLAME_STUDY_NATIVE_SEARCH_BINDINGS) {
  const bindings=JSON.parse(readFileSync(process.env.BLAME_STUDY_NATIVE_SEARCH_BINDINGS,"utf8"));
  registerHooks({load(url,context,nextLoad){
    const result=nextLoad(url,context);
    const suffix=url.split("/@cline/core/dist/")[1],expected=bindings.modules?.[suffix];
    if(!expected)return result;
    const source=String(result.source);if(sha(source)!==expected)throw Error("SDK artifact changed before search repair");
    const repaired=repairSearchSource(source);if(!repaired)throw Error("Registered SDK bundle lacks search implementation");
    if(process.env.BLAME_STUDY_NATIVE_SEARCH_AUDIT)appendFileSync(process.env.BLAME_STUDY_NATIVE_SEARCH_AUDIT,JSON.stringify({module:suffix,originalSha256:sha(source),repairedSha256:sha(repaired.source),functionName:repaired.functionName})+"\n");
    return {...result,source:repaired.source};
  }});
}
