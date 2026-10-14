// Private behavioral oracle; no expected patch or feedback reaches a model.
import {createRequire} from "node:module";
import {join} from "node:path";
import vm from "node:vm";
export async function auditFreshBehavior(workspace) {
  const esbuild=createRequire(join(workspace,"package.json"))("esbuild");
  const bundle=esbuild.buildSync({entryPoints:[join(workspace,"src/index.ts")],bundle:true,platform:"node",format:"cjs",write:false,logLevel:"silent"});
  const module={exports:{}};
  vm.runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,require:createRequire(join(workspace,"package.json"))});
  const z=module.exports,checks=[];
  for(const async of [false,true]) for(const value of [undefined,"ok",0,false]) {
    const data=Object.assign(Object.create({inherited:"omit"}),{present:value});
    const schema=z.record(z.any());
    const parsed=async ? await schema.parseAsync(data) : schema.parse(data);
    checks.push({name:`own-presence:${async?"async":"sync"}:${String(value)}`,passed:
      Object.prototype.hasOwnProperty.call(parsed,"present")&&parsed.present===value&&
      !Object.prototype.hasOwnProperty.call(parsed,"inherited")&&Object.keys(parsed).length===1});
  }
  const transformed=z.record(z.string().transform(()=>undefined));
  for(const async of [false,true]) {
    const parsed=async?await transformed.parseAsync({present:"input"}):transformed.parse({present:"input"});
    checks.push({name:`transform-presence:${async?"async":"sync"}`,passed:Object.prototype.hasOwnProperty.call(parsed,"present")&&parsed.present===undefined});
    const pollution=async?await z.record(z.any()).parseAsync(JSON.parse('{"__proto__":{"polluted":true},"kept":1}')):
      z.record(z.any()).parse(JSON.parse('{"__proto__":{"polluted":true},"kept":1}'));
    checks.push({name:`prototype-protection:${async?"async":"sync"}`,passed:pollution.kept===1&&!Object.prototype.hasOwnProperty.call(pollution,"__proto__")&&pollution.polluted===undefined});
    const result=async?await z.record(z.number()).safeParseAsync({bad:"x"}):z.record(z.number()).safeParse({bad:"x"});
    checks.push({name:`issue-path:${async?"async":"sync"}`,passed:!result.success&&JSON.stringify(result.error.issues[0].path)==='["bad"]'});
  }
  return checks;
}
