import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const repo=resolve(new URL('../../..',import.meta.url).pathname),study=join(repo,'docs/experiments/light-harness-validation-view-f32-2026-10-16'),json=async n=>JSON.parse(await readFile(join(study,n)));
const controls=await json('local-controls.json'),replay=await json('recorded-replay.json'),checks=await json('production-checks.json'),t=replay.totals;
const rollback=await json('rollback-checks.json');assert(rollback.rows.every(r=>r.exitCode===0));
const keep=controls.rows[1].exitCode===0&&checks.rows.every(r=>r.exitCode===0)&&checks.bindings.every(r=>r.match);
assert(keep);const available=t.selectedPointers-t.missingLogs,perLog=(t.renderCpuMs.candidate-t.renderCpuMs.baseline)/t.renderCpuMs.repetitions/available;
assert.equal(t.changedLogs,0);assert.equal(t.gainedLines,0);
const decision={paidRequests:0,decision:'keep-experimental-revert-production-integration',modelEfficacyMeasured:false,criteria:'Controlled cases and candidate source regressions pass,but all17 observed Light logs already expose all52 detected summaries. No observed visibility gain and added scan CPU justify keeping the prototype isolated. Constructed gains do not replace the neutral result on recorded logs.',candidateIntegrationCommit:'e7b1df3dd2e6b0ac0f32e2486221f367798303a0',productionRollbackCommit:rollback.commit,currentProductionIncludesPrototype:false,measured:t,limitation:'Known-log presentation replay and constructed controls; no model comparison,task-success,billed-token,cache,cost or model-duration improvement measured. Later confirmation may select multi-stage logs before outcomes.'};
await writeFile(join(study,'decision.json'),JSON.stringify(decision,null,2)+'\n');
const lines=['# F32 local validation-summary results','',
'**Keep experimental; revert the temporary production integration.** No F32 model efficacy is measured. Both frozen F31 Light arms keep their original presentation.','',
'| Measure | Original | Modified |','|---|---:|---:|',
'| Controlled cases passed | 2/8 | 8/8 |',
`| Visible detected summary occurrences | ${t.baselineVisible}/${t.detectedLines} | ${t.candidateVisible}/${t.detectedLines} |`,
`| Projected characters across available logs | ${t.baselineCharacters} | ${t.candidateCharacters} |`,
`| Projected UTF-8 bytes | ${t.baselineBytes} | ${t.candidateBytes} |`,
`| Pure render CPU ms (${t.renderCpuMs.repetitions} repetitions/log) | ${t.renderCpuMs.baseline.toFixed(3)} | ${t.renderCpuMs.candidate.toFixed(3)} |`,
'',`${t.selectedPointers} selected original log pointers,${t.missingLogs} missing logs,${t.changedLogs} changed views. ${t.gainedLines} summary occurrences become visible;${t.lostLines} formerly visible occurrences are lost. Selection includes failed trials and every recorded Light log pointer; unlogged commands are outside this replay,not imputed.`,
'',`The renderer adds approximately ${perLog.toFixed(4)} ms/log in this local alternating-order microbenchmark. This is added CPU work,not a model latency result. Indexed lines take space from other diagnostic context; excessive summaries remain explicitly partial. Character/byte totals do not establish billed-token savings. Identical repeated summary text can make substring visibility optimistic; raw archived logs and line locations remain inspectable.`,
'','Before rollback,the temporarily integrated candidate passed581 current-source harness cases with2 skipped (583 total),TypeScript compilation and package lint; both compiled modules matched the isolated candidate. Real successful/failed command controls preserve counts,unknown pending and unverified admission. No observation/admission fields are recomputed by the recorded replay. Original F31 grades,command results and source are unchanged. Separate rollback-checks.json verifies restored production.','',
'An initial CommonJS/ESM test-loader setup failure and the host pnpm status-hook failure remain separate. A broader built-dist scan records607 cases,including two failing abandoned F29 phrase-ranking controls absent from current source; both failures reproduce on the old frozen runtime. See stale-dist-checks.json and preexisting-dist-failures.json. Current checks select source tests. The six old-presentation visibility failures are expected mechanism controls,not six pre-existing product behavior failures.','',
'See README.md for protocol,risks and public no-model replay commands. Invocation identity,npm lifecycle semantics,native concurrency and truthful final prose require subsequent controls; this change does not establish those outcomes.',''];
await writeFile(join(study,'report.md'),lines.join('\n'));console.log(JSON.stringify(decision));
