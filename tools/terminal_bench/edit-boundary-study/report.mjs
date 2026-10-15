import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const json=async n=>JSON.parse(await readFile(join(study,n))),s=await json('guidance-summary.json'),p=await json('protocol.json'),d=await json('decision.json');
const pct=n=>n==null?'unavailable':(100*n).toFixed(1)+'%',usd=n=>n.toFixed(6);
const lines=[`# F31 whole-symbol indentation (${s.completed}/${s.planned})`,'',p.decision,'','One executable module differs. All actual initial tool descriptions,schemas and normalized system prompts must match. Native is integrated ClineSDK0.0.82 with the pinned research search repair. Audits are unblinded research-agent judgments,not independent human reviews.','',
'| Arm | Trials/planned | Official | Frozen endpoint | Actual checks | Behavior | Full audited | Tokens | SDK USD | Worker seconds |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
for(const arm of p.arms){const r=s.arms[arm];lines.push(`| ${arm} | ${r.trials}/${r.planned} | ${r.official} | ${r.functional} | ${r.actualChecks} | ${r.manualBehaviorPassed}/${r.manualBehaviorReviewed} | ${r.strict} | ${r.tokensObserved} | ${usd(r.estimatedUsdObserved)} | ${r.runnerSecondsObserved.toFixed(3)} |`);}
lines.push('','All-attempt totals retain failures and usage gaps; missing usage is not zero. Frozen acceptance includes clean-source build,supplied/private probes,type checks,original default suites and the separately named fast-glob E2E suite. Executed tests,passed tests,admitted verification and all user criteria remain distinct.','',
'## Conditional paired resources','','| Left/right | Eligible pairs | Tokens | SDK estimate | Worker time |','|---|---:|---:|---:|---:|');
for(const c of s.comparisons.filter(c=>c.tier==='strict'))lines.push(`| ${c.left}/${c.right} | ${c.pairs} | ${pct(c.resources.tokens.relativeChange)} | ${pct(c.resources.cost.relativeChange)} | ${pct(c.resources.seconds.relativeChange)} |`);
lines.push('','Changes are `(left/right)-1` on matched audited successes with reconciled cost/tokens and no observed wire/usage gap. These subsets cannot override all-attempt quality. Two dependent issue clusters cannot establish population noninferiority.','',
'## Per-task full / behavioral acceptance','','| Task | Baseline | Candidate | Cline |','|---|---:|---:|---:|');
for(const task of s.tasks)lines.push(`| ${task.id} | `+p.arms.map(arm=>`${task.arms[arm].strict}/${task.arms[arm].trials} ; ${task.arms[arm].manualBehaviorPassed}/${task.arms[arm].trials}`).join(' | ')+' |');
lines.push('','## Decision and accounting','',`Recorded gate: **${d.decision}**; observed-quality gate=${d.qualityGate},resource gate=${d.resourceGate}. Local replay correctness is not a measured model gain.`,
'',`New SDK estimate USD${usd(s.accounting.observedUsd)},new reserve USD${usd(s.accounting.reservedUsd)}. Prior accounted USD${usd(s.priorAccountedUsd)}. Cumulative **USD${usd(s.totalAccountedUsd)}**,reference **EUR${s.referenceEquivalentEur.toFixed(4)}**. Retain all earlier unresolved reserves; no reset.`,
'','SDK estimates are not invoices. Researcher-agent,host/setup/tool/oracle costs,provider revisions/seeds,hidden retries and full per-request cache attribution remain unpriced/unknown. Cache reads are a subset of input. The nominal8192 output cap is absent on actual OAuth requests; byte guards,reserves and timeouts are separate.','');
await writeFile(join(study,'report.md'),lines.join('\n'));
