import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const definitions=[
 {id:'yaml-anchor-ranges',project:'yaml',issue:'https://github.com/eemeli/yaml/issues/729',
  allowedPaths:['src/compose/compose-node.ts','src/nodes/Node.ts','src/nodes/Scalar.ts','src/nodes/Collection.ts','src/nodes/YAMLMap.ts','src/nodes/YAMLSeq.ts'],
  request:'Implement the backward-compatible anchorRange alternative from issue729. Parsed anchored scalar,sequence and map nodes,including empty values,must expose optional anchorRange:[number,number] using zero-based UTF-16 offsets [start,end),including the ampersand and complete anchor token. Keep anchor a string. Expose a precise optional tuple on public node types,including ParsedNode. Preserve tag/comment ordering,alias resolution,existing errors,range and serialization behavior. Unanchored nodes,aliases and programmatically anchored nodes must not gain an own anchorRange property. The field is available independently of keepSourceTokens. clone() must retain a separately copied anchorRange tuple.',
  fixture:'yaml-fixture.cjs',fixturePath:'tests/agent-anchor-contracts.cjs',selected:'tests/agent-anchor-ranges.cjs',
  typePath:'tests/_utils/agent-anchor-types.ts',typeText:"import type { ParsedNode } from '../../src/index.ts'\ndeclare const node: ParsedNode\nconst range: [number, number] | undefined = node.anchorRange\nvoid range\n// @ts-expect-error A source range is not a string.\nnode.anchorRange = 'bad'\n// @ts-expect-error A source range has exactly two entries.\nnode.anchorRange = [1, 2, 3]\n",
  verifierCommands:{build:['npm','run','build:node'],selected:['node','--test','--test-timeout=5000','tests/agent-anchor-ranges.cjs'],types:['npm','run','test:types'],full:['npm','test','--','--runInBand']},modules:['jest','typescript','rollup']},
 {id:'fast-glob-dynamic-filter',project:'fast-glob',issue:'https://github.com/mrmlnc/fast-glob/issues/265',
  allowedPaths:['src/settings.ts','src/providers/filters/entry.ts','src/providers/filters/deep.ts','src/types/index.ts','src/readers/reader.ts','src/readers/async.ts','src/readers/stream.ts'],
  request:'Implement issue265 as an optional synchronous public Options.filter:(entry:Entry)=>boolean callback. Omission preserves current behavior. For sync,async and stream APIs,apply the callback to eligible file/directory entries before output; a false result excludes that entry. During dynamic traversal,false for a directory also prevents descending into it,including when onlyFiles is true. Support both static and dynamic patterns,string and object outputs. The callback receives the original Entry with path and dirent,not a transformed output string. Preserve existing pattern/ignore,depth,symlink,uniqueness and filesystem-adapter constraints. Callback errors must propagate with their identity through the existing sync throw/async rejection/stream error paths. Call frequency for an entry encountered by multiple traversal/output filters is unspecified; no asynchronous callback support is requested. Expose precise callback types without weakening existing options.',
  fixture:'glob-fixture.cjs',fixturePath:'tests/agent-glob-contracts.cjs',selected:'tests/agent-glob-filter.cjs',
  typePath:'src/tests/agent-filter-types.ts',typeText:"import * as fg from '../index';\nconst options: fg.Options = { filter: entry => entry.dirent.isDirectory() || entry.path.endsWith('.txt') };\nvoid options;\n// @ts-expect-error filter requires a function.\nconst bad: fg.Options = { filter: 'bad' };\nvoid bad;\n// @ts-expect-error synchronous boolean result required.\nconst asyncFilter: fg.Options = { filter: async () => true };\nvoid asyncFilter;\n",
  verifierCommands:{build:['npm','run','compile'],selected:['node','--test','--test-timeout=5000','tests/agent-glob-filter.cjs'],types:['npm','run','compile'],full:['npm','test'],e2e:['npm','run','test:e2e']},modules:['mocha','typescript','micromatch','minipass']}
];
const common=' Work independently from this checkout only. Do not retrieve remote history,issue comments,reference solutions,previous benchmark artifacts or private verifier sources. Preserve original tests,assertions,manifests,lockfiles and configuration. Do not add files. Inspect implementation and relevant tests. Report actual commands,outcomes and observed counts; unknown categories stay unknown. Disclose limitations.';
export const tasks=await Promise.all(definitions.map(async d=>{
 const fixture=await readFile(join(repo,'tools/terminal_bench/edit-boundary-study',d.fixture),'utf8');
 const selected="require('./"+d.fixturePath.split('/').at(-1)+"')(require('node:test').test);\n";
 const inputFiles={[d.fixturePath]:fixture,[d.selected]:selected,[d.typePath]:d.typeText};
 const checks=Object.values(d.verifierCommands).map(a=>a.join(' '));
 return {...d,kind:d.id,partition:'fresh-confirmation',inputFiles,requiredChecks:[],selectedTests:[d.selected],
 selectedSourceSha256:Object.fromEntries(await Promise.all(d.allowedPaths.map(async path=>[path,sha(await readFile(join(work,'upstreams',d.project,path)))]))),
 instruction:d.request+' Implementation edits are restricted to '+d.allowedPaths.join(', ')+'.'+common+' After the final edit run these exact commands in order: '+[...new Set(checks)].join('; ')+'.\n'};
}));
if(process.argv[2]==='select')await writeFile(join(study,'task-selection.json'),JSON.stringify({selectedAtUTC:new Date().toISOString(),paidRequests:0,scope:'Two real public feature requests on two previously unmeasured projects; API/edge-case choices are researcher-specified issue-derived tasks,not official benchmark instances. Three dependent repeats; no reference implementation accessed.',tasks},null,2)+'\n',{flag:'wx'});
