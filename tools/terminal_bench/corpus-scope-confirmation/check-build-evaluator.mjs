import assert from 'node:assert/strict';
import { requiredBuildEvidence } from './required-builds.mjs';
const scenario={requiredBuilds:[{id:'build',cwd:'.'},{id:'scope-labels:build',cwd:'packages/labels'}]};
const edit={tool:'edit_code',input:{},output:{status:'ok',data:{changed:true}}};
const build=id=>({tool:'run_task',input:{kind:'project',task:id},output:{status:'ok',data:{exitCode:0}}});
const inspect=tools=>requiredBuildEvidence(tools,scenario,'/fixture').passed;
assert.equal(inspect([edit,build('build')]),false);
assert.equal(inspect([edit,build('scope-labels:build')]),false);
assert.equal(inspect([edit,build('build'),build('scope-labels:build')]),true);
assert.equal(inspect([build('build'),build('scope-labels:build'),edit]),false);
assert.equal(inspect([edit,build('build'),{...build('scope-labels:build'),output:{status:'blocked',category:'code'}}]),false);
const native=commands=>({tool:'run_commands',input:{commands,unused:{commands:['npm run build']}},output:commands.map(()=>({success:true}))});
assert.equal(inspect([edit,native(['cd /fixture && npm run build','cd /fixture/packages/labels && npm run build'])]),true);
assert.equal(inspect([edit,native(['cd /fixture && npm run build'])]),false);
assert.equal(inspect([edit,native(['node -e "console.log(\'npm run build\')"'])]),false);
for (const masked of ['npm run build ; true', 'npm run build || true', 'npm run build | cat', 'npm run build & true'])
  assert.equal(inspect([edit,native([masked,'cd /fixture/packages/labels && npm run build'])]),false);
assert.equal(inspect([edit,native(['npm run build && npm --prefix packages/labels run build'])]),true);
console.log('Required root/child checks, failure, freshness, inert metadata and masked-exit controls passed.');
