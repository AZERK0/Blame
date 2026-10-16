// Separate post-selected uncertainty relaxation; never overwrite primary grades.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { study } from './paths.mjs';
const results = JSON.parse(await readFile(join(study, 'results.json')));
const accepted = r => r.fullAuditedSuccess || (r.officialRuntimeSuccess && r.independentFunctionalSuccess &&
  r.review?.sourceBehaviorPassed && r.review?.noSolutionRetrieval && r.review?.semicolonEvidenceSensitivity === true &&
  r.review.criteriaFailures.length === 1 && r.review.criteriaFailures[0] === 'earlier_check_exit_statuses_not_established_by_semicolon_chain');
const relaxed = results.rows.filter(r => !r.fullAuditedSuccess && accepted(r)).map(r => r.name);
const output = { paidRequests: 0, postSelectedSensitivity: true,
  method: 'Admit only the individually reviewed semicolon-chain evidence uncertainty: required commands ran serially, visible Node/Jest results passed and build/type output showed no error, but earlier individual non-test exit statuses are not recorded. This does not prove those statuses; the strict audit and financial/failed-trial records stay unchanged.',
  relaxedTrials: relaxed, acceptedCounts: Object.fromEntries(['baseline', 'candidate', 'cline'].map(arm => [arm, results.rows.filter(r => r.arm === arm && accepted(r)).length])),
  limitation: 'Unblinded post-hoc sensitivity, not a preregistered grade or a recovery of source/agent execution.' };
await writeFile(join(study, 'apparent-validation-sensitivity.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ relaxedTrials: relaxed, acceptedCounts: output.acceptedCounts }));
