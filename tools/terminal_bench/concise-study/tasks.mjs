import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {repo,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const root=join(repo,'.blame/research/concise-f30/upstreams/commander');
const common=' Work independently in this checkout. Do not retrieve reference solutions, remote history, previous benchmark artifacts or private verifier sources. Preserve unrelated APIs, original tests and supplied fixtures. Do not change manifests, lockfiles, configuration or assertions. Do not add files. Inspect implementation and relevant tests. Report only actual outcomes and observed counters; unreported categories are unknown. Disclose validation limitations.';
const definitions=[
 {id:'commander-canonical-choices',kind:'choices',paths:['lib/option.js','lib/argument.js','typings/index.d.ts'],request:'Extend both Option.choices and Argument.choices with an optional second configuration argument {caseInsensitive:true}. Only an exactly true flag enables matching by String.toLowerCase(); return the first matching original choice spelling. Absent, null and non-true configurations retain current case-sensitive behavior. Preserve the copied choices array, help spelling, errors, custom parser replacement order, variadic accumulation/default identity, fluent subclass returns and existing hooks/exceptions. Add matching readonly TypeScript input declarations without weakening existing types.'},
 {id:'commander-hidden-arguments',kind:'hidden-arguments',paths:['lib/argument.js','lib/help.js','typings/index.d.ts'],request:'Add Argument.hidden (initially false) and fluent Argument.hideHelp(hide=true), coercing hide to boolean like Option.hideHelp. Help.visibleArguments must exclude hidden arguments. Preserve legacy description assignment, argument identity/order and the original rule that an Arguments table is shown only when at least one visible argument has a description; then include all visible arguments. Preserve the enumerable own-property shape of unconfigured arguments (existing structural comparisons must keep working). Hiding affects only detailed help entries, never usage syntax, required validation, parsing, callbacks or registeredArguments. Make the new public members available in TypeScript without weakening existing types.'},
 {id:'commander-environment-fallback',kind:'env-fallback',paths:['lib/option.js','lib/command.js','lib/help.js','typings/index.d.ts'],request:'Extend Option.env(primaryName, fallbackNames?) with an optional readonly list of fallback environment-variable names. Keep envVar as the primary string for compatibility and copy the fallback list. Each env() call replaces earlier fallback configuration; omission resets it. Resolve primary then fallbacks in order, selecting the first defined variable, including empty strings. Preserve CLI/client/default/config/env precedence and boolean/optional/negated/variadic handling. Keep the public optionEnv event arguments unchanged. Invoke custom parsing exactly once for the selected value and preserve arbitrary thrown error identity. Invalid-value diagnostics must name the actual selected variable. Help must list configured names in order separated by comma-space after the existing env: label. Update public TypeScript inputs without weakening existing types.'},
];
const fixture=await readFile(join(repo,'tools/terminal_bench/concise-study/fixtures.cjs'),'utf8');
const fullLauncher='// Keep Jest options out of process.argv: upstream tests call Command.parse().\n// Restore ordinary color-test conditions; the host exports NO_COLOR=1.\ndelete process.env.NO_COLOR;\nrequire("jest").run(["--runInBand","--coverage=false"]);\n';
export const tasks=await Promise.all(definitions.map(async d=>{
 const selected='tests/agent-'+d.kind+'.cjs';
 const selectedText="const {test}=require('node:test');require('./agent-contracts.cjs')(require('../'),"+JSON.stringify(d.kind)+",test);\n";
 const commands={selected:['node','--test',selected],types:['npm','run','check:type'],full:['node','tests/agent-project-suite.cjs']};
 return {id:d.id,kind:d.kind,project:'commander',partition:'fresh-confirmation',allowedPaths:d.paths,
  selectedSourceSha256:Object.fromEntries(await Promise.all(d.paths.map(async path=>[path,sha(await readFile(join(root,path)))]))),
  inputFiles:{'tests/agent-contracts.cjs':fixture,[selected]:selectedText,'tests/agent-project-suite.cjs':fullLauncher},
  requiredChecks:[],selectedTests:[selected],verifierCommands:commands,
  instruction:d.request+' Restrict implementation edits to '+d.paths.join(', ')+'.'+common+
   ' After the final edit run exactly '+commands.selected.join(' ')+' and npm run check:type and node tests/agent-project-suite.cjs.\n'};
}));
if(process.argv[2]==='select')await writeFile(join(study,'task-selection.json'),JSON.stringify({selectedAtUTC:new Date().toISOString(),paidRequests:0,
 scope:'Three fresh constructed API tasks on Commander13.1.0, not previously model-measured in this study. Each needs two or three implementation modules plus public declarations. Three dependent repeats; no claim of independent external issue confirmation.',tasks},null,2)+'\n',{flag:'wx'});
