# Next cycle: bounded proposals, not measured improvements

Keep success and truthful delivery ahead of resources. F33 fixes presentation;
F34 is a known-task diagnostic and cannot supply fresh-task generalization.

| Priority | Observation and current code | Causal hypothesis and comparison | Measures and regression risks |
| --- | --- | --- | --- |
| 1. Effective request-output limit | F34 Cline R1 reports 128,000 output tokens, malformed parallel arguments and a cost stop; actual OAuth requests omit the nominal 8,192-token cap. `appendProductionConfig` and actual Core config splitting preserve 8,192. Existing legacy-handler serializer tests pass, but do not exercise the complete runtime path. | Locate the later drop with a full SDK offline request capture, then test backend acceptance/enforcement in one separately budgeted feasibility probe. Only then compare one effective cap change at fixed model/effort and task criteria. | Actual transmitted cap, successful complete tool arguments, audited acceptance before output/cost/latency. Preserve missing responses/reserves. Risks: unsupported backend parameter, truncated useful reasoning/patches and lower success. No production cap fix or backend support is yet established. |
| 2. Read-only dependency declarations | F31 glob agents receive dependency-navigation refusals and recover through shell reads. `LightWorkspace.readPath` calls `assertMutableWorkspacePath`; `workspace-files.ts` excludes `node_modules` from navigation and edits together. Compiler reference collection also excludes dependency locations. This remains implemented. | A separately guarded read-only declaration route, resolved through the configured JS/TS project and exact installed version, may replace broad shell inspection. Compare existing fallback, the isolated read-only route and integrated Cline. Preserve edits/rename protection and observation guards. | Correct declaration/version identity, discovery/repair calls, actual emitted context, audited task success, tokens/cache/cost/time. Test symlinks, package aliases, project references, stale versions, large declarations, `.env`/metadata and writes. Risks: wrong version, broader scope, more context/CPU, accidental edit authorization. |
| 3. Explicit exact-command selection | F33 proves project tasks use npm wrappers. The frozen literal `npm test` requirement still differs from `npm run test`; `run_task` description does not explain this spelling difference. Required-check contracts support trusted catalog task IDs/args, not arbitrary inferred commands (`light-contracts.ts`). | First isolate one instruction explaining project resolution and when a caller's literal command requires command mode. Consider structured executable/argv evidence separately; do not infer trusted obligations from model prose or silently change execution to satisfy a benchmark spelling. | Correct tool selection, actual final-source invocation/order, factual reporting, acceptance and resource overhead. Test without forcing the tool route; accept documented aliases in future task criteria unless spelling itself is meaningful. Risk: extra raw commands and loss of managed test evidence. |

For priority 2, choose fresh cross-file/dependency tasks on larger projects before
results, without implementation-file hints. Freeze source, installed dependencies,
prompts, schemas, model/effort, environment, order and budgets. Keep known diagnostic
tasks separate; use the same finite repeated assignments for all three arms. Preserve
failures, missing observations and absent mechanism exposure. Compare resources only
on explicitly audited joint successes, alongside every assigned attempt. A larger
repository is an opportunity for savings, not evidence that savings will occur.

Separately, F34's administrative capture preserves a dead worker without model
retry and resumes only the unexecuted suffix. Before reusing that facility, add
interruption/restart controls for pre-dispatch, streaming, command and grading
stages. This is experiment infrastructure, not evidence of a production harness
defect or another claimed model optimization.
