// Common research-only projection. Freeze the prompt date without changing
// process clocks, durations, OAuth expiry, source/test execution or SDK timeouts.
import {registerHooks} from 'node:module';
import {readFileSync,appendFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const binding=JSON.parse(readFileSync(process.env.BLAME_STUDY_DATE_BINDING,'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
registerHooks({load(url,context,nextLoad){
 const result=nextLoad(url,context);
 if(!url.endsWith('/agent-runtime/dist/cline-runtime-prompts.js'))return result;
 const source=String(result.source);
 if(!binding.originalHashes.includes(sha(source)))throw Error('Prompt-date source changed');
 const needle='CURRENT_DATE: new Date().toISOString().slice(0, 10)';
 if(source.split(needle).length!==2)throw Error('Prompt-date anchor changed');
 const patched=source.replace(needle,'CURRENT_DATE: '+JSON.stringify(binding.fixedDate));
 if(process.env.BLAME_STUDY_DATE_AUDIT)appendFileSync(process.env.BLAME_STUDY_DATE_AUDIT,JSON.stringify({originalSha256:sha(source),patchedSha256:sha(patched),fixedDate:binding.fixedDate})+'\n');
 return {...result,source:patched};
}});
