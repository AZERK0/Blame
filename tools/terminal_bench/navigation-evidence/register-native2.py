"""Fresh registration only; never overwrite an existing paid campaign."""
from pathlib import Path
import json,datetime,subprocess,shutil
r=Path(__file__).resolve().parents[3];s=r/'docs/experiments/light-harness-navigation-evidence-f27-2026-10-14-native2'
assert not (s/'protocol.json').exists()
old=r/'docs/experiments/light-harness-navigation-evidence-f26-2026-10-14-fresh-zod';p=json.loads((old/'protocol.json').read_text())
now=datetime.datetime.now(datetime.timezone.utc).isoformat();fx=json.loads(Path('/tmp/blame-f27-fx.json').read_text());rate=min(fx['eur']['usd'],p['budgetAmendment']['referenceFx']['usdPerEur'])
p.update(panel='f27',studyKind='corrected-native-confirmation',nativeSearchRepair=True,phaseOrder=['confirmation','diagnostic'],registeredAtUTC=now,taskInputCommitAtUTC='2026-10-14T12:00:00+00:00',baseCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=r,text=True).strip(),status='local-preflight-no-model-dispatch',repetitions=3)
p['budgets']['sharedStudyObservedCostStopUsd']=round(2*rate*.98,6);p['budgets']['panelObservedCostStopUsd']=p['budgets']['sharedStudyObservedCostStopUsd']
p['budgetAmendment']={'authorizedCeilingEur':2,'scope':'New explicit user authorization raises the same cumulative ceiling from EUR1 to EUR2; no accounting reset.','operationalCeilingUsd':p['budgets']['sharedStudyObservedCostStopUsd'],'referenceFx':{'source':'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json','retrievedAtUTC':now,'quoteDate':fx['date'],'usdPerEur':rate,'currentQuoteUsdPerEur':fx['eur']['usd'],'invoiceExchangeRateVerified':False},'change':'Retain all older estimates,missing-response reserves and incomplete panels. Two percent FX headroom; unchanged per-trial limits/full-response reserve. Registered before F27 results.'}
p['priorCampaigns'].append('.blame/research/navigation-evidence-fresh-zod/f26/analysis.json')
p['upstreams']['rxjs']={'commit':'e5351d02e225e275ac0e497c7b66eaa5f0c88791','version':'7.8.2','sourceRoot':'.blame/research/native-confirmation/rxjs','dependencyRoot':'.blame/research/native-confirmation/dependencies','modules':['typescript','ts-node','esbuild','mocha','node-linux-x64']}
p['environmentArtifacts']=['.blame/research/native-confirmation/dependencies/node_modules/node-linux-x64/bin/node']
p['selection']='Two fresh RxJS tasks selected before any model result: a cross-file internal API migration and a real unseeded stream/iterator lifecycle repair. RxJS has251production and189spec TypeScript files,larger than Zod84. Separately repeat both already observed Zod tasks as known diagnostics under clarified criteria. Primary confirmation first:3repetitions*2tasks*3arms=18; diagnostic stratum18 later. No post-result task replacement or efficacy pooling.'
p['intervention']='Reference Light disables only compiler rename; current Light keeps the identical production runtime. Native integrated SDK0.0.82 receives a separate pinned load-time search-function repair: complete bounded matches,match-line display and correct file-bound contexts. Installed dependencies unchanged; repair never loaded in Light. Same native schema/prompt. Local legacy/repaired comparison isolates information behavior; no paid legacy SDK arm identifies a causal model benefit from that fix.'
p['decision']='Analyze fresh confirmation separately from known diagnostics and older campaigns. Primary official,functional,actual-check,strict report and admission endpoints remain distinct. Pair resources only at matched audited success and reconciled consumption; preserve failures,timeouts,byte stops,unexecuted assignments and missing usage. Single changed Light capability; natural nonactivation is not causal rename evidence. No source repair,retry,gold lookup,or verifier feedback. Three repeats/two fresh clusters do not establish population equivalence.'
p['taskOrder']='Execute confirmation stratum before diagnostics; within each stratum fixed task order first repetition,reverse later; rotate arms by task index and repetition. All36 slots frozen before dispatch. Preserve strict cumulative admission stop.'
p['accounting']='Prior accounted USD0.82594076 includes all observed estimates and the old USD0.23 missing-response reserve. Preserve USD0.27 next-trial allowance; nominal8192 is not effective on actual OAuth,so retain full128000-output reserve. User ceiling EUR2 is cumulative.'
p['oracleRegistration']='Private upstream TypeScript4.2.4 binding oracle for RxJS/5.4.5 for Zod plus behavioral probes and protected supplied regressions. Positive and negative local controls before dispatch; no oracle source or reference patch reaches a model.'
p['reportingAudit']='Executed bodies,passed,failed and pending/skipped remain separate. Zod original545,record+fixture549. RxJS original3243passed/8pending under pinned Node16.20.2,not the3251discovered executed. Confirm exact counts from actual commands,including any failed intermediate checks.'
p['preflightNotes']=['RxJS upstream on host Node24 has2preexisting failures:JSON SyntaxError message and global WebSocket availability. Preserve that result; pin project-only Node16.20.2 matching its era,without modifying/skipping assertions. Model runtime stays Node24.','Minimal exact dependency environments and package locks archived;no upstream devtool installation assumed.','No applicable AGENTS.md in RxJS source. Read root README and source configuration; all task workspaces contain original instructions.','F26 primary scores remain unchanged. Optional auxiliary members require explicit new task opt-in plus original-member preservation; invalid/required types and unrelated edits rejected by local controls.']
node='node_modules/node-linux-x64/bin/node';test=['env','TS_NODE_PROJECT=tsconfig.mocha.json',node,'node_modules/mocha/bin/mocha','--config','spec/support/.mocharc.js'];types=[node,'node_modules/typescript/bin/tsc','--project','src/tsconfig.base.json','--noEmit','--incremental','false','--module','commonjs','--target','es2018','--skipLibCheck']
commandTypes=' '.join(types);commandFull="TS_NODE_PROJECT=tsconfig.mocha.json "+' '.join([node,'node_modules/mocha/bin/mocha','--config','spec/support/.mocharc.js',"'spec/**/*-spec.ts'"])
common=' Work independently; do not retrieve published solutions,reference patches,old source revisions,previous campaign artifacts or verifier source. Preserve original/supplied assertions,dependencies,configuration,unrelated comments/literals/APIs and module paths. Do not add files beyond supplied fixtures. After the final edit run '+commandTypes+' and '+commandFull+'. Report actual passed,failed and pending/skipped counts,not discovered cases as executed; disclose validation limitations.\n'
fixture='''import { arrRemove as retainedLocal } from "./arrRemove";
import * as helpers from "./arrRemove";
export { arrRemove as stablePublicName } from "./arrRemove";
// Preserve the arrRemove literal and unrelated homonym.
function arrRemove() { return "arrRemove"; }
export const localExample = arrRemove();
export const aliasExample = retainedLocal;
export const namespaceExample = helpers.arrRemove;
'''
regression='''import { expect } from 'chai';
import { firstValueFrom, scheduled, asyncScheduler } from 'rxjs';
import { readableStreamLikeToAsyncGenerator } from '../src/internal/util/isReadableStreamLike';
describe('stream lifecycle regression', () => {
  function fixture() {
    const state = { canceled: 0, released: 0 };
    const stream = { getReader: () => ({ read: async () => ({ done: false as const, value: 1 }), cancel: async () => { state.canceled++; }, releaseLock: () => { state.released++; } }) };
    return { state, stream };
  }
  it('cancels and releases on direct early iterator return', async () => {
    const { state, stream } = fixture();
    const iterator = readableStreamLikeToAsyncGenerator(stream);
    await iterator.next(); await iterator.return();
    expect(state).to.deep.equal({ canceled: 1, released: 1 });
  });
  it('scheduled early subscription close also cleans up', async () => {
    const { state, stream } = fixture();
    expect(await firstValueFrom(scheduled(stream, asyncScheduler))).to.equal(1);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(state).to.deep.equal({ canceled: 1, released: 1 });
  });
});
'''
known=p['tasks']
for t in known:t['partition']='diagnostic'
known[1]['permittedAuxiliaryMembers']={'src/helpers/parseUtil.ts':{'ObjectPair':{'alwaysSet':'boolean'}}}
known[1]['instruction']+=' Optional alwaysSet:boolean metadata may also be added to ObjectPair; preserve every existing type member.\n'
p['tasks']=[{'id':'rxjs-array-removal-migration','partition':'confirmation','kind':'multifile-rename','project':'rxjs','oldName':'arrRemove','newName':'removeArrayItem','declarationPath':'src/internal/util/arrRemove.ts','allowedPaths':[],'inputFiles':{'src/internal/util/navigation-fixture.ts':fixture},'mutableInputFiles':['src/internal/util/navigation-fixture.ts'],'selectedTests':['spec/Subscription-spec.ts','spec/Subject-spec.ts'],'verifierCommands':{'selected':test+['spec/Subscription-spec.ts','spec/Subject-spec.ts'],'types':types,'full':test+['spec/**/*-spec.ts']},'requiredChecks':[],'instruction':'Rename the internal exported helper arrRemove to removeArrayItem in src/internal/util/arrRemove.ts and every identifier resolving to that export across the project. Preserve local import aliases,stable public aliases,unrelated homonyms,comments,literals,behavior and module paths,including the supplied navigation-fixture.ts. Do not rename files or directories.'+common},
{'id':'rxjs-stream-lifecycle','partition':'confirmation','kind':'rxjs-stream-lifecycle','project':'rxjs','allowedPaths':['src/internal/util/isReadableStreamLike.ts','src/internal/scheduled/scheduleAsyncIterable.ts','src/internal/types.ts'],'inputFiles':{'spec/stream-lifecycle-spec.ts':regression},'selectedTests':['spec/observables/from-spec.ts','spec/scheduled/scheduled-spec.ts','spec/stream-lifecycle-spec.ts'],'mutableFunctions':{'src/internal/util/isReadableStreamLike.ts':['readableStreamLikeToAsyncGenerator'],'src/internal/scheduled/scheduleAsyncIterable.ts':['scheduleAsyncIterable'],'src/internal/types.ts':[]},'permittedAuxiliaryMembers':{'src/internal/types.ts':{'ReadableStreamDefaultReaderLike':{'cancel':'callable'}}},'verifierCommands':{'selected':test+['spec/observables/from-spec.ts','spec/scheduled/scheduled-spec.ts','spec/stream-lifecycle-spec.ts'],'types':types,'full':test+['spec/**/*-spec.ts']},'requiredChecks':[],'instruction':'Fix stream/iterator lifecycle handling in RxJS. Both normal and scheduled readable-stream consumption must cancel the underlying reader exactly once on early consumer closure when cancel exists,and always release the lock even if cancellation rejects. Natural exhaustion releases without canceling. Older reader objects without cancel must remain usable; an optional cancel method may be added to ReadableStreamDefaultReaderLike,preserving existing members. Scheduled async iterable consumption must have at most one pending next(),return the iterator exactly once on early unsubscribe,stop further pulls,and deliver next() rejections to the subscriber without unhandled promise rejections. Preserve emitted order and other existing behavior. Limit implementation edits to readableStreamLikeToAsyncGenerator,scheduleAsyncIterable,and that optional reader type member. Supplied regression assertions are protected.'+common},*known]
(s/'protocol.json').write_text(json.dumps(p,indent=2)+'\n')
shutil.copyfile(old/'disable-compiler-rename.patch',s/'disable-compiler-rename.patch')
for project,root in [('rxjs','.blame/research/native-confirmation/dependencies'),('zod','.blame/research/fresh-confirmation/dependencies')]:
 for f in ['package.json','package-lock.json']:shutil.copyfile(r/root/f,s/(project+'-environment-'+f))
(s/'fx-reference.json').write_text(json.dumps(p['budgetAmendment']['referenceFx'],indent=2)+'\n')
print(json.dumps({'planned':36,'fresh':18,'diagnostic':18,'operationalUsd':p['budgets']['sharedStudyObservedCostStopUsd']}))
