import {rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {repo,sha,json,save,prepare as prepareF42} from '../confirmation-study/setup.mjs';
import {prepareIsolatedNodeEnvironment} from '../isolated-node-environment.mjs';
export {repo,sha,json,save};
export const work='/tmp/blame-path-recovery-f43';
export const study=join(repo,'docs/experiments/light-harness-path-recovery-f43-2026-10-17');
export const dependencyRoot=join(repo,'.blame/research/path-recovery-f43/dependencies');
export async function prepare(root,id,isolated=false){
 await prepareF42(root,id);
 await rm(join(root,'node_modules'));
 if(isolated){
  const environment=await prepareIsolatedNodeEnvironment({baselineModules:join(dependencyRoot,'node_modules'),workspace:root,cacheRoot:resolve(root,'../npm-cache')});
  // Light commands use bash -lc, which resets inherited PATH in this host's
  // login profile. Reapply the same pinned tool environment for every arm.
  const shellPath=resolve(root,'../shell-environment.sh');
  environment.env.PATH=join(root,'node_modules/.bin')+':'+process.env.PATH;
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  const shell=Object.entries(environment.env).map(([key,value])=>'export '+key+'='+quote(value)).join('\n')+'\n';
  await writeFile(shellPath,shell);environment.env.BASH_ENV=shellPath;
  environment.shellEnvironmentSha256=sha(shell);
  await save(resolve(root,'../environment.json'),environment);
 }else await symlink(join(dependencyRoot,'node_modules'),join(root,'node_modules'));
 const pkg=await json(join(root,'package.json'));
 pkg.scripts['test:study:upstream']='node node_modules/vitest/vitest.mjs run --config .study/vitest.config.mjs';
 await save(join(root,'package.json'),pkg);
 const paths=id==='valibot-fallback-when'?['methods/fallback/fallback','methods/fallback/fallbackAsync']:['storages/globalConfig/globalConfig','utils/_addIssue/_addIssue'];
 const config={test:{include:paths.map(p=>'library/src/'+p+'.test.ts'),maxWorkers:1,fileParallelism:false,cache:false}};
 await writeFile(join(root,'.study/vitest.config.mjs'),'export default '+JSON.stringify(config)+';\n');
 execFileSync('git',['add','-f','package.json','.study'],{cwd:root});
 execFileSync('git',['-c','user.name=Study','-c','user.email=study@example.invalid','commit','--quiet','--amend','--no-edit'],{cwd:root,env:{...process.env,GIT_AUTHOR_DATE:'2026-10-17T00:00:00Z',GIT_COMMITTER_DATE:'2026-10-17T00:00:00Z'}});
}
