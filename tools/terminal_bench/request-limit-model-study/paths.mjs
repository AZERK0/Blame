import {resolve,join} from 'node:path';
export const repo=resolve(new URL('../../..',import.meta.url).pathname);
export const work=join(repo,'.blame/research/request-limits-model-f36');
export const study=join(repo,'docs/experiments/light-harness-request-limits-model-f36-2026-10-16');
export const studyFor=panel=>{if(panel!=='f36')throw Error('F36 only');return study;};
