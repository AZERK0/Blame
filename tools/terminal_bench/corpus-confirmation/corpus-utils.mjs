import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandOutput, repositoryRoot } from '../corpus/corpus-utils.mjs';
export { repositoryRoot, workspaceDiff } from '../corpus/corpus-utils.mjs';
export const corpusRoot = dirname(fileURLToPath(import.meta.url));
export async function prepareWorkspace(workspace, scenarioId) {
  await mkdir(dirname(workspace), { recursive: true });
  await cp(join(corpusRoot, 'fixture'), workspace, { recursive: true });
  await writeFile(join(workspace, '.bench-scenario'), `${scenarioId}\n`);
  await symlink(join(repositoryRoot, 'node_modules'), join(workspace, 'node_modules'), 'dir');
  const env = { ...process.env, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' };
  for (const args of [['init', '--initial-branch=main'], ['config','user.email','terminal-bench@blame.local'], ['config','user.name','Blame confirmation'], ['add','.'], ['commit','-q','-m','Confirmation fixture']]) commandOutput('git',args,workspace,env);
  return commandOutput('git',['rev-parse','HEAD'],workspace).trim();
}
