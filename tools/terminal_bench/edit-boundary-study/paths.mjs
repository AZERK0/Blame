import {resolve,join} from 'node:path';
export const repo=resolve(new URL('../../..',import.meta.url).pathname);
export const work=join(repo,'.blame/research/edit-boundaries-f31');
export const study=join(repo,'docs/experiments/light-harness-edit-boundaries-f31-2026-10-16');
export const studyFor=panel=>{if(panel!=='f31')throw Error('F31 only');return study;};
