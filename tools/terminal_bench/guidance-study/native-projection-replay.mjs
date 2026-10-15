// Zero-model diagnostic. Recorded output is not necessarily model-visible output.
// Run only the pinned SDK's pure text clipping helper, not a model/session/tool.
import assert from 'node:assert/strict';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const sdk=await realpath(join(repo,'packages/agent-runtime/node_modules/@cline/sdk/package.json'));
const source=await readFile(join(dirname(sdk),'../core/dist/index.js'),'utf8');
const binding=await json(join(study,'native-search-bindings.json'));
assert.equal(sha(source),binding.modules['index.js']);
const settings=await json(join(study,'execution-bindings.json'));
assert.equal(settings.inheritedSettingsSha256,sha('{}'),'Nondefault inherited settings need separate projection reconstruction');
const ts=createRequire(join(repo,'packages/agent-runtime/package.json'))('typescript');
const ast=ts.createSourceFile('sdk.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='c6');
const variables=ast.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]);
const marker=variables.find(n=>n.name.getText(ast)==='CH').initializer.getText(ast);
const declaration=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='lJ');
const ctor=declaration.members.find(ts.isConstructorDeclaration).getText(ast);
const defaultName=ctor.match(/this\.maxToolResultChars=[A-Za-z0-9_$]+\(\$\.maxToolResultChars,([A-Za-z0-9_$]+)\)/u)?.[1];
assert(defaultName,'Pinned constructor anchor changed');
const limit=Number(variables.find(n=>n.name.getText(ast)===defaultName).initializer.getText(ast));
assert.equal(limit,8000);
const clip=Function('return ('+fn.getText(ast)+')')(),makeMarker=Function('return ('+marker+')')();
const name='1-date-fns-offset-helper-migration-cline';
const events=await readFile(join(work,'f28',name,'events.jsonl'),'utf8');
const calls=events.trim().split('\n').map(s=>JSON.parse(s).event).filter(e=>e.type==='tool'&&e.payload?.phase==='finished');
const call=calls.find(e=>e.payload.toolCall?.name==='run_commands'&&e.payload.toolCall.input.commands?.includes('npm run types'));
assert(call);const output=call.payload.output;
const full=output.find(r=>r.query==='npm test -- --maxWorkers=1 --minWorkers=1 --pool=forks');assert(full);
const raw=String(full.result),projected=clip(raw,limit,makeMarker);
const aggregate=/Tests\s+3140 passed\s*\|\s*18 skipped/u;
assert(aggregate.test(raw));assert(!aggregate.test(projected));assert(projected.includes('[truncated '));
const artifact='native-command-projected.txt.gz';await writeFile(join(study,artifact),gzipSync(projected,{mtime:0}));
const result={paidRequests:0,trial:name,eventsSha256:sha(events),sdkOriginalModuleSha256:sha(source),
 limit,rawCharacters:raw.length,projectedCharacters:projected.length,rawAggregatePresent:true,projectedAggregatePresent:false,
 projectedArtifact:{artifact,bytes:Buffer.byteLength(projected),sha256:sha(projected)},
 purePinnedHelper:{source:fn.getText(ast),markerSource:marker,defaultConstant:defaultName},
 conclusion:'The original tool event contains the complete Vitest aggregate, but the pinned default native SDK middle clipping removes it before model presentation. Qualified unknown aggregate counts are therefore justified; raw trace output alone cannot establish what the model saw.',
 limitations:'Replays this text projection under frozen default settings; it is not an archived full model request or a new model efficacy comparison. Light uses a separate context projection. No production/native SDK dependency is modified.'};
await writeFile(join(study,'native-projection-diagnostic.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,purePinnedHelper:undefined}));
