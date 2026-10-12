// Independent criteria: grammar-aware source integrity plus behavior, no gold patch.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { identifierTokens, onlyIdentifierRename } from "../corpus/identifier-token-audit.mjs";
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const ts = createRequire(join(repo, "packages/agent-runtime/package.json"))("typescript");
const [workspace, taskId, study] = process.argv.slice(2);
const protocol = JSON.parse(await readFile(join(study, "protocol.json"), "utf8"));
const task = protocol.tasks.find(t => t.id === taskId);
if (!task) throw new Error("Unregistered task");
const originalRoot = join(repo, protocol.upstreams[task.project].sourceRoot);
const checks = [];
const hash = value => createHash("sha256").update(value).digest("hex");
function maskFunctions(text, names) {
  const source = ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error("Invalid source syntax");
  const ranges = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.body && names.includes(node.name?.text))
      ranges.push({ name: node.name.text, start: node.getStart(source), end: node.end });
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const name of names) if (ranges.filter(r => r.name === name).length !== 1)
    throw new Error("Missing or ambiguous editable function " + name);
  for (const range of ranges.sort((a,b) => b.start-a.start))
    text = text.slice(0,range.start) + ";" + text.slice(range.end);
  return identifierTokens(text);
}
for (const [path, expected] of Object.entries(task.selectedSourceSha256)) {
  let original = await readFile(join(originalRoot, path), "utf8");
  if (hash(original) !== expected) throw new Error("Original source differs from registration: " + path);
  if (task.seed?.path === path) {
    if (original.split(task.seed.before).length !== 2) throw new Error("Seed is not unique");
    original = original.replace(task.seed.before, task.seed.after);
  }
  const current = await readFile(join(workspace, path), "utf8");
  const passed = task.kind === "rename"
    ? onlyIdentifierRename(original,current,task.oldName,task.newName)
    : JSON.stringify(maskFunctions(original, task.mutableFunctions[path])) ===
      JSON.stringify(maskFunctions(current, task.mutableFunctions[path]));
  checks.push({ name: "registered-source-integrity:"+path, passed, sourceSha256:hash(current) });
}
if (task.newTest) {
  const text = await readFile(join(workspace,task.newTest), "utf8");
  checks.push({name:"requested-additive-tests",passed:text.trim().length>0,sourceSha256:hash(text)});
}
if (task.kind === "behavior") {
  let contents = 'const assert = require("node:assert/strict");\n';
  if (task.project === "date-fns") {
    const name = task.id === "date-fns-same-hour-bug" ? "isSameHour" : task.id === "date-fns-same-day-bug" ? "isSameDay" : task.id === "date-fns-inclusive-bug" ? "isWithinInterval" : "clamp";
    contents += `import { ${name} as subject } from "./src/${name}/index.ts";\n`;
    if (name === "isSameDay") contents += `
      for (const year of [1999,2000,2024]) for (const month of [0,5,11]) {
        const a=new Date(year,month,15,0,1), b=new Date(year,month,15,23,59);
        assert.equal(subject(a,b),true); assert.equal(subject(+a,+b),true);
        assert.equal(subject(a,new Date(year,month,16)),false);
        assert.equal(subject(a,new Date(year,month+1,15)),false);
        assert.equal(subject(a,new Date(year+1,month,15)),false);
        const beforeA=+a,beforeB=+b; subject(a,b); assert.equal(+a,beforeA); assert.equal(+b,beforeB);
      }
      assert.equal(subject(new Date(NaN),new Date(0)),false);
      assert.equal(subject(new Date(0),new Date(NaN)),false);
      assert.equal(subject(new Date(NaN),new Date(NaN)),false);
    `;
    else if (name === "isSameHour") contents += `
      for (const year of [1999,2000,2024]) for (const month of [0,5,11]) for (const hour of [0,6,23]) {
        const a=new Date(year,month,15,hour,0,1), b=new Date(year,month,15,hour,59,59);
        assert.equal(subject(a,b),true); assert.equal(subject(+a,+b),true);
        assert.equal(subject(a,new Date(year,month,15,hour+1)),false);
        assert.equal(subject(a,new Date(year,month,16,hour)),false);
        assert.equal(subject(a,new Date(year,month+1,15,hour)),false);
        assert.equal(subject(a,new Date(year+1,month,15,hour)),false);
        const beforeA=+a,beforeB=+b; subject(a,b); assert.equal(+a,beforeA); assert.equal(+b,beforeB);
      }
      assert.equal(subject(new Date(NaN),new Date(0)),false);
      assert.equal(subject(new Date(0),new Date(NaN)),false);
      assert.equal(subject(new Date(NaN),new Date(NaN)),false);
    `;
    else if (name === "isWithinInterval") contents += `
      for (const bounds of [[1000,9000],[9000,1000],[1000,1000]])
        for (const n of [0,999,1000,1001,5000,8999,9000,9001,10000]) {
          const expected = n >= Math.min(...bounds) && n <= Math.max(...bounds);
          assert.equal(subject(new Date(n), {start:new Date(bounds[0]),end:new Date(bounds[1])}), expected);
        }
      assert.equal(subject(new Date(NaN),{start:new Date(0),end:new Date(1)}),false);
      assert.equal(subject(new Date(0),{start:new Date(NaN),end:new Date(1)}),false);
      assert.equal(subject(new Date(0),{start:new Date(0),end:new Date(NaN)}),false);
    `;
    else contents += `
      class SpecialDate extends Date {}
      for (const bounds of [[1000,9000],[9000,1000],[1000,1000]])
        for (const n of [0,999,1000,1001,5000,8999,9000,9001,10000]) {
          const input = new SpecialDate(n), start = new Date(bounds[0]), end = new Date(bounds[1]);
          const result = subject(input,{start,end});
          assert.equal(+result,Math.max(Math.min(...bounds),Math.min(n,Math.max(...bounds))));
          assert.equal(+input,n); assert.equal(+start,bounds[0]); assert.equal(+end,bounds[1]);
          assert.ok(result instanceof SpecialDate); assert.notEqual(result,input);
        }
      for (const args of [[NaN,0,1],[0,NaN,1],[0,0,NaN]])
        assert.ok(Number.isNaN(+subject(new Date(args[0]),{start:new Date(args[1]),end:new Date(args[2])})));
      const withContext = subject(new Date(5000),{start:new Date(9000),end:new Date(1000)},{in:v=>new SpecialDate(v)});
      assert.ok(withContext instanceof SpecialDate); assert.equal(+withContext,5000);
    `;
    const esbuild = createRequire(join(workspace,"package.json"))("esbuild");
    const output = esbuild.buildSync({stdin:{contents,resolveDir:workspace,loader:"ts",sourcefile:"acceptance.ts"},
      bundle:true,write:false,platform:"node",format:"cjs",target:"node20"}).outputFiles[0].text;
    new Function("require",output)(createRequire(join(workspace,"package.json")));
  } else {
    const require = createRequire(join(workspace,"package.json"));
    const subject = require(join(workspace,"lodash.js"));
    const assert = require("node:assert/strict");
    if (task.id === "lodash-clamp-bug") {
      for (const bounds of [[-5,5],[0,5],[-10,-5],[5,5]])
        for (const n of [-Infinity,-11,-5,0,2,5,10,Infinity])
          assert.equal(subject.clamp(n,...bounds),Math.max(bounds[0],Math.min(n,bounds[1])));
      assert.equal(subject.clamp(-9,5),-9); assert.equal(subject.clamp(9,5),5);
      assert.equal(subject.clamp("3","0","5"),3); assert.ok(Number.isNaN(subject.clamp(NaN,0,5)));
    } else {
      for (const [start,end] of [[0,5],[5,0],[-5,5],[5,5]])
        for (const n of [-6,-5,0,4.5,5,6])
          for (const flag of [undefined,false,true,1,"true"])
            assert.equal(subject.inRange(n,start,end,flag),n>=Math.min(start,end) &&
              (flag===true ? n<=Math.max(start,end) : n<Math.max(start,end)));
      assert.equal(subject.inRange(2,5),true); assert.equal(subject.inRange(5,5),false);
      assert.equal(subject.inRange("5","0","5",true),true);
      assert.equal(subject.inRange(NaN,0,5,true),false);
    }
  }
  checks.push({name:"independent-behavior-and-edge-cases",passed:true});
}
console.log(JSON.stringify({ checks, compiler:ts.version,
  criterion:"Frozen parsed-source integrity and independent behavior; actual required suites and post-final-edit agent validation audited separately. No language-service expected solution." }));
if (!checks.every(check=>check.passed)) process.exitCode=1;
