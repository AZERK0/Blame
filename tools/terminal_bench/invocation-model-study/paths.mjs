import {resolve,join} from 'node:path';
export const repo=resolve(new URL('../../..',import.meta.url).pathname);
export const work=join(repo,'.blame/research/invocation-model-f34');
export const study=join(repo,'docs/experiments/light-harness-invocation-model-f34-2026-10-16');
export const studyFor=panel=>{if(panel!=='f34')throw Error('F34 only');return study;};
