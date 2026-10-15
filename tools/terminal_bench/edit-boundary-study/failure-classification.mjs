// Describe original controller errors; never turn correct grader output into delivery.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const results=JSON.parse(await readFile(join(study,'results.json')));
const rows=results.rows.map(r=>{
 const error=typeof r.error==='string'?r.error:JSON.stringify(r.error);
 let mechanism=r.officialRuntimeSuccess?'completed':'other_or_unknown',details={};
 const bytes=error?.match(/Research request byte budget exceeded before dispatch: (\d+) > (\d+)/u),iterations=error?.match(/exceeded maxIterations \((\d+)\)/u);
 if(bytes){mechanism='research_request_byte_guard';details={requestBytes:Number(bytes[1]),byteLimit:Number(bytes[2]),rejectedBeforeDispatch:true};}
 else if(iterations){mechanism='max_iterations';details={maximumIterations:Number(iterations[1])};}
 else if(r.exit?.watchdog)mechanism='outer_watchdog';
 return{name:r.name,official:r.officialRuntimeSuccess,frozenEndpoint:r.independentFunctionalSuccess,actualChecks:r.agentRequiredChecksPassed,behavior:r.manualBehaviorPassed,full:r.auditedCompletion,originalRuntimeError:r.error,mechanism,...details,manualCriteriaFailures:r.manualCriteriaFailures,eventsSha256:r.eventsSha256,scoreSha256:r.scoreSha256};
});
await writeFile(join(study,'failure-classification.json'),JSON.stringify({paidRequests:0,method:'Labels come from exact original controller errors or watchdog flags. Test-case timeouts,worker deadlines,iteration limits,serialization limits and code-quality outcomes remain distinct. No source repair,rerun,grade or consumption changes.',rows},null,2)+'\n');
