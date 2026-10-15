import {resolve,join} from 'node:path';
export const repo=resolve(new URL('../../..',import.meta.url).pathname);
export const work=join(repo,'.blame/research/concise-f30');
export const study=join(repo,'docs/experiments/light-harness-concise-f30-2026-10-15');
export const studyFor=panel=>{if(panel!=='f30')throw Error('F30 only');return study;};
