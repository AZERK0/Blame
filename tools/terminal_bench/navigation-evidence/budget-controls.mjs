// Replay the retained provider error and budget admission without model calls.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { reserveTrialCosts } from "./budget-accounting.mjs";
const repo=resolve(new URL("../../..",import.meta.url).pathname);
const root=join(repo,"docs/experiments/light-harness-mechanism-confirmation-2026-10-13");
const json=async path=>JSON.parse(await readFile(path,"utf8"));
const protocol=await json(join(root,"protocol-v2.json"));
const rows=[],wire={};
for(const panel of protocol.panelOrder){
 const study=join(repo,`docs/experiments/light-harness-navigation-evidence-${panel}-2026-10-13-confirm2`);
 rows.push(...(await json(join(study,"results.json"))).rows);
 const archive=JSON.parse(gunzipSync(await readFile(join(study,"wire-contracts.json.gz"))));
 for(const trial of archive.trials)if(!trial.missing)wire[trial.name]=trial.requests;
}
const failure=rows.find(r=>r.name==="2-lodash-isInteger-node-confirmation-cline");
assert.equal(failure.status,"failed");assert.equal(failure.usage.cost,.0009594);
assert.equal(wire[failure.name].length,2);assert.equal(failure.usage.perRequest.length,1);
const full=reserveTrialCosts(rows,wire,protocol.budgets);
assert.ok(Math.abs(full.observedUsd-.178056)<1e-12);
assert.equal(full.reservedUsd,.23);
assert.ok(Math.abs(full.accountedUsd-.408056)<1e-12);
const afterError=rows.slice(0,rows.indexOf(failure)+1);
const replay=reserveTrialCosts(afterError,wire,protocol.budgets);
const admissionAllowance=protocol.budgets.perTrialSdkCostLimitUsd+protocol.budgets.requestOvershootReserveUsd;
assert.ok(replay.observedUsd+admissionAllowance<.5,"Old aggregate-only scheduler admitted next trial");
assert.ok(replay.accountedUsd+admissionAllowance>.5,"Corrected scheduler stops before next trial");
const synthetic=(cost,reports,requests=reports)=>[{name:"control",usage:{cost,perRequest:Array(reports).fill({}),requests,
 tokensCostReconciled:requests===reports}}];
assert.equal(reserveTrialCosts(synthetic(.01,2),{control:[{},{}]},protocol.budgets).reservedUsd,0);
assert.equal(reserveTrialCosts(synthetic(.01,1),{control:[{},{budgetRejected:true}]},protocol.budgets).reservedUsd,0);
assert.equal(reserveTrialCosts(synthetic(null,0,1),{control:[{}]},protocol.budgets).reservedUsd,.27);
assert.equal(reserveTrialCosts(synthetic(null,0,3),{control:[{},{},{}]},protocol.budgets).reservedUsd,.73);
assert.equal(reserveTrialCosts(synthetic(.01,1,2),{},protocol.budgets).reservedUsd,.23);
await writeFile(join(root,"missing-response-budget-controls.json"),JSON.stringify({method:"Post-campaign actual retained error replay plus healthy/rejected/missing-aggregate/legacy controls; zero paid requests. Prospective scheduler change only, original campaign outcomes/bindings never rewritten.",
 originalErrorName:failure.name,fullCampaignObservedUsd:full.observedUsd,reservedUnreportedRequestUsd:full.reservedUsd,
 observedPlusReserveUsd:full.accountedUsd,afterErrorObservedUsd:replay.observedUsd,
 correctedAfterErrorAccountedUsd:replay.accountedUsd,nextTrialAllowanceUsd:admissionAllowance,
 originalAggregateOnlyWouldAdmit:true,correctedWouldStop:true,controls:6,paidRequests:0},null,2)+"\n");
console.log(JSON.stringify({observed:full.observedUsd,reserved:full.reservedUsd,correctedWouldStop:true,controls:6,paidRequests:0}));
