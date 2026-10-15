// Render facts, not an automatic retain/reject decision or a population claim.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const json=async name=>JSON.parse(await readFile(join(study,name),'utf8'));
const summary=await json('guidance-summary.json'),protocol=await json('protocol.json');
const mechanisms=await json('guidance-mechanisms.json');
const money=n=>n.toFixed(6),pct=n=>n===null?'unavailable':(100*n).toFixed(1)+'%';
const lines=[`# F28 recorded results (${summary.completed}/${summary.planned} assignments)`,
 '',summary.completed===summary.planned?'All registered assignments completed.':'**Ongoing prefix only.** Later registered assignments continue; these numbers are not a completed-panel comparison.',
 '', 'Four new constructed clusters on three familiar projects, three dependent repetitions per task and nine rotated serial arms. No external benchmark certification or representative population claim.',
 '', '| Arm | Trials/planned | Official | Functional | Actual checks | Full audited | Observed tokens | SDK USD | Wire/usage gaps |',
 '|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
for(const arm of protocol.arms){const r=summary.arms[arm];lines.push(`| ${arm} | ${r.trials}/${r.planned} | ${r.official} | ${r.functional} | ${r.actualChecks} | ${r.strict} | ${r.tokensObserved} | ${money(r.estimatedUsdObserved)} | ${r.missingWireUsageResponses} |`);}
lines.push('', 'Token/cost columns are observed subtotals over all attempts. Missing aggregates and request gaps are counted separately in `guidance-summary.json`; they are never imputed as zero consumption. Official runtime completion is not audited user success. Formal admission remains separate. Cache reads are a subset of input, reasoning a subset of output; full per-request cache ledgers and invoices remain unverified.',
 '', '## Conditional paired resources',
 '', 'Identical task/repetition pairs must both complete officially, pass the independent endpoint, execute the requested final-source checks, satisfy the manual factual criteria and avoid solution retrieval. Input/output/cost must reconcile and have zero observed wire/report gap. This conditions on success; it is not an all-attempt or population efficiency estimate.',
 '', '| Left / right | Discordant audited successes (left/right) | Eligible pairs | Tokens | Estimated cost | Worker time |',
 '|---|---:|---:|---:|---:|---:|');
for(const c of summary.comparisons.filter(c=>c.tier==='strict'))lines.push(`| ${c.left} / ${c.right} | ${c.quality.leftOnlyAudited}/${c.quality.rightOnlyAudited} | ${c.pairs} | ${pct(c.resources.tokens.relativeChange)} | ${pct(c.resources.cost.relativeChange)} | ${pct(c.resources.seconds.relativeChange)} |`);
lines.push('', 'Changes are `(left/right)-1`. Keep task-specific pairs and all adverse attempts in the JSON; dependent repetitions and differing successful subsets cannot establish equivalence or identify a generally optimal factor.',
 '', '## Natural mechanism exposure',
 '', '| Arm | Empty file scopes | Bare-reference fallback | Reference hints | Rich rename receipts | Truncated reads / hints | Check-journal reads | Patch correction hints |',
 '|---|---:|---:|---:|---:|---:|---:|---:|');
for(const arm of protocol.arms){const rs=mechanisms.rows.filter(r=>r.arm===arm),sum=key=>rs.reduce((n,r)=>n+r.exposure[key],0);lines.push(`| ${arm} | ${sum('emptyFileScopes')} | ${sum('bareReferenceFallbacks')} | ${sum('referenceFollowupHints')} | ${sum('richRenameReceipts')} | ${sum('truncatedReads')}/${sum('continuationHints')} | ${sum('checkJournalReads')} | ${sum('patchRecoveryHints')} |`);}
lines.push('', 'Exposure is descriptive: an exact later call matching a hint does not prove that the hint caused it. Tool output bytes are not billed tokens. Common task instructions already require unknown skipped counts. Native changes multiple mechanisms. No activation supports no model benefit claim for that mechanism.',
 '', '## Financial accounting',
 '', `New observed SDK estimates: USD${money(summary.accounting.observedUsd)}; new missing-response reserves: USD${money(summary.accounting.reservedUsd)}. Prior observed/reserved accounting: USD${money(summary.priorAccountedUsd)}. Cumulative accounted: **USD${money(summary.totalAccountedUsd)}**, reference equivalent **EUR${summary.referenceEquivalentEur.toFixed(4)}**, against the cumulative EUR10 authorization and USD${protocol.budgets.sharedStudyObservedCostStopUsd} operational stop.`,
 '', 'The nominal 8192 output cap is ineffective on actual OAuth. Admission retains a USD0.23 full-response allowance in addition to the USD0.04 SDK soft stop. Exchange reference is not an invoice exchange rate; host/setup/tool compute is unpriced. Preserve failures, timeouts, byte stops, missing usage and every remaining assignment.',
 '', '## Evidence and limits',
 '', '`source-review.json` binds unblinded manual decisions to complete recorded inputs, final diffs and scores. Public replay checks these decisions and calculations, not their independent re-adjudication. The private grader never repairs source or feeds back to a model. RxJS original async-suite limitations persist; supplied new callback-style tests and independent lifecycle probes complement the full suite. Models may still make incorrect scope assumptions or factual claims despite a correct source endpoint.',
 '', 'Local controls establish the six implemented contracts and factor isolation; they do not establish net model benefit. The frozen source, date projection, native search repair, initial Git identities and actual model/effort/byte guard are checked separately. Provider revision/seeds, hidden retries and complete cache remain unknown.', '');
await writeFile(join(study,'report.md'),lines.join('\n'));
console.log(JSON.stringify({completed:summary.completed,planned:summary.planned,report:join(study,'report.md')}));
