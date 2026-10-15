// Apply the registered gate without changing it after outcomes.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const s=JSON.parse(await readFile(join(study,'guidance-summary.json'))),p=JSON.parse(await readFile(join(study,'protocol.json')));
const contrast=s.comparisons.find(c=>c.left==='candidate'&&c.right==='baseline'&&c.tier==='strict');
const tasks=s.tasks.map(t=>({id:t.id,baselineFull:t.arms.baseline.strict,candidateFull:t.arms.candidate.strict,baselineBehavior:t.arms.baseline.manualBehaviorPassed,candidateBehavior:t.arms.candidate.manualBehaviorPassed,
 noLowerObservedQuality:t.arms.candidate.strict>=t.arms.baseline.strict&&t.arms.candidate.manualBehaviorPassed>=t.arms.baseline.manualBehaviorPassed}));
const qualityGate=tasks.every(t=>t.noLowerObservedQuality),r=contrast.resources;
const resourcesAvailable=contrast.pairs>0&&[r.tokens.relativeChange,r.cost.relativeChange,r.seconds.relativeChange].every(Number.isFinite);
const resourceGate=resourcesAvailable&&(r.tokens.relativeChange<=-.10||r.cost.relativeChange<=-.10)&&r.cost.relativeChange<=.05&&r.seconds.relativeChange<=.10;
const complete=s.completed===s.planned;
const decision=complete?(qualityGate&&resourceGate?'retain-provisionally':'keep-prototype-isolated'):'pending-complete-panel';
const output={method:'Apply preregistered observed-quality and paired-resource gates,not a statistical population-equivalence test. Local controls passed before dispatch; complete non-description execution text is unchanged.',completed:s.completed,planned:s.planned,complete,registeredGate:p.decisionGate,tasks,qualityGate,resourceGate,resourcesAvailable,eligiblePairs:contrast.pairs,resources:r,decision,
 limitation:'Three constructed clusters on one new project,dependent repeats,unblinded model labels/review and unknown provider revision/seeds limit external validity. Length and wording emphasis are not separately identified. A selected successful subset cannot erase all-attempt failures. No outcome-based extra trials.'};
await writeFile(join(study,'decision.json'),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({complete,qualityGate,resourceGate,decision,eligiblePairs:contrast.pairs}));
