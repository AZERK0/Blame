import {resolve,join} from 'node:path';
export const repo=resolve(new URL('../../..',import.meta.url).pathname);
export const work=join(repo,'.blame/research/guidance-f28');
export const study=join(repo,'docs/experiments/light-harness-guidance-f28-2026-10-15');
export const studyFor=panel=>{if(panel!=='f28')throw Error('F28 only');return study;};
