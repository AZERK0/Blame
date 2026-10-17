import{execFileSync}from'node:child_process';import{cp,mkdir,readFile}from'node:fs/promises';import{join}from'node:path';import{repo,work,study,save,sha}from'./setup.mjs';
await mkdir(join(study,'inputs'),{recursive:true});const artifacts={};
for(const name of ['valibot','remeda']){const to=join(study,'inputs',name+'.tar.gz');await cp(join(work,'upstream',name+'.tar.gz'),to);artifacts[name+'.tar.gz']=sha(await readFile(to));}
for(const arm of ['reference','compiler']){const name='frozen-'+arm+'.tar.gz',to=join(study,'inputs',name);execFileSync('tar',['-czf',to,'--exclude=node_modules','-C',join(work,'frozen',arm),'agent-runtime','benchmark-runner']);artifacts[name]=sha(await readFile(to));}
await cp(join(repo,'pnpm-lock.yaml'),join(study,'inputs/workspace-pnpm-lock.yaml'));artifacts['workspace-pnpm-lock.yaml']=sha(await readFile(join(repo,'pnpm-lock.yaml')));
await save(join(study,'input-archives.json'),{artifacts,note:'Frozen executable JS, maps/types, prompts and plugin assets are complete. Node_modules links are excluded; install pinned workspace/dependency locks and bind the recorded SDK versions. Reference differs only at the recorded task-catalog ablation.'});
console.log(artifacts);
