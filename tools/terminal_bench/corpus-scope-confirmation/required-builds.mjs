import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export function requiredBuildEvidence(tools, scenario, workspaceRoot) {
  const mutations = tools.map((tool,index) => ({tool,index})).filter(({tool}) =>
    (tool.tool === 'edit_code' && tool.output?.status === 'ok' && tool.output.data?.changed) ||
    (tool.tool === 'run_task' && tool.output?.status === 'ok' && tool.output.data?.changed) ||
    (tool.tool === 'apply_patch' && /Successfully applied patch/u.test(JSON.stringify(tool.output))));
  const lastMutation = mutations.at(-1)?.index ?? Infinity;
  const evidence = [];
  const cwd = value => {
    if (!value) return '.';
    const clean = value.replace(/^['"]|['"]$/gu,'').replace(workspaceRoot,'<fixture>');
    const relative = clean.replace(/^<fixture>\/?/u,'');
    return posix.normalize(relative || '.').replace(/\/$/u,'') || '.';
  };
  for (let index=0;index<tools.length;index++) {
    if (index <= lastMutation) continue;
    const tool = tools[index];
    if (tool.tool === 'run_task' && tool.output?.status === 'ok' && tool.output.data?.exitCode === 0 && tool.input.kind === 'project') {
      const item = scenario.requiredBuilds.find(item => item.id === tool.input.task);
      if (item) evidence.push({toolIndex:index,id:item.id,cwd:item.cwd,route:'declared project task'});
      continue;
    }
    const commands = tool.tool === 'run_commands' ? (tool.input.commands ?? []).map((command,i) => ({
      command,passed:Array.isArray(tool.output) && tool.output[i]?.success === true,
    })) : tool.tool === 'run_task' && tool.input.kind === 'command' ? [{
      command:tool.input.command,passed:tool.output?.status === 'ok' && tool.output.data?.exitCode === 0,
    }] : [];
    for (const {command,passed} of commands) {
      if (!passed) continue;
      let directory = cwd(tool.input.cwd);
      // Bounded evidence extractor; unknown shell forms remain unknown for manual review.
      for (const segment of command.split(/\s*&&\s*/u)) {
        const cd = segment.match(/^cd\s+(.+)$/u);
        if (cd) {
          const next = cwd(cd[1]);
          directory = segment.includes(workspaceRoot) || segment.includes('<fixture>') ? next : posix.normalize(posix.join(directory,next));
          continue;
        }
        // A wrapper's zero exit cannot certify a masked subcommand failure.
        // Admit only complete simple build segments; other forms need manual evidence.
        if (!/^(?:npm|pnpm|yarn)\s+(?:(?:--prefix|--dir|-C)\s+\S+\s+)?(?:run\s+)?build$/u.test(segment.trim())) continue;
        const prefix = segment.match(/(?:--prefix|--dir|-C)\s+(['"]?[^'"\s]+['"]?)/u);
        const scope = prefix ? cwd(prefix[1]) : directory;
        const item = scenario.requiredBuilds.find(item => item.cwd === scope);
        if (item) evidence.push({toolIndex:index,id:item.id,cwd:item.cwd,route:'declared shell build',command:segment});
      }
    }
  }
  return {passed:scenario.requiredBuilds.every(item=>evidence.some(e=>e.id===item.id)),lastMutationIndex:Number.isFinite(lastMutation)?lastMutation:null,evidence};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2]);
  const analysis = JSON.parse(await readFile(join(root,'analysis.json')));
  const ledger = JSON.parse(await readFile(join(root,'tool-ledger.json')));
  const manifest = JSON.parse(await readFile(new URL('./manifest.json',import.meta.url)));
  const candidates = JSON.parse(await readFile(join(root,'audit-candidates.json')));
  for (const decision of candidates.decisions) {
    const row = analysis.rows.find(r=>r.name===decision.name);
    const scenario = manifest.scenarios.find(s=>s.id===row.id);
    assert.ok(scenario);
    const inspected = requiredBuildEvidence(ledger.find(r=>r.name===row.name).tools,scenario,join(root,row.name,'workspace'));
    decision.originalSharedBuildCandidate = decision.taskObligations;
    decision.requiredBuildInspection = inspected;
    decision.taskObligations &&= inspected.passed;
    decision.independentSuccessCandidate &&= inspected.passed;
  }
  await writeFile(join(root,'audit-candidates.json'),JSON.stringify(candidates,null,2)+'\n');
  console.log(JSON.stringify({requiredBuildInspection:candidates.decisions.map(d=>({name:d.name,passed:d.requiredBuildInspection.passed}))}));
}
