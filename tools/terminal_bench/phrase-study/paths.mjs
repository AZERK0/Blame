import {join} from 'node:path';
export {repo} from '../guidance-study/paths.mjs';
import {repo} from '../guidance-study/paths.mjs';
export const work=join(repo,'.blame/research/confirmation-f29');
export const study=join(repo,'docs/experiments/light-harness-phrase-ranking-f29-2026-10-15');
export const studyFor=panel=>{if(panel!=='f29')throw Error('F29 only');return study;};
