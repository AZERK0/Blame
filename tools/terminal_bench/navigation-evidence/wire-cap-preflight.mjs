// Offline only: prove every proposed frozen arm sends the same explicit request cap.
import {resolve,join} from "node:path";
const repo=resolve(new URL("../../..",import.meta.url).pathname);
const {createHandler}=await import(join(repo,"packages/agent-runtime/node_modules/@cline/llms/dist/index.js"));
const limit=Number(process.argv[2]);if(!Number.isSafeInteger(limit)||limit<1)throw Error("Specify a positive request output cap");
if(process.argv.length<4)throw Error("Provide every proposed runtime dist directory");
for(const path of process.argv.slice(3)){
 const dist=resolve(path),{appendProductionConfig}=await import(join(dist,"production.js"));
 const config=appendProductionConfig({providerId:"openai-codex",modelId:"gpt-5.6-luna",maxTokensPerTurn:128000},{requestMaxOutputTokens:limit});
 if(config.maxTokensPerTurn!==limit)throw Error("Frozen arm does not support the common request cap: "+dist);
 const payloads=[];const request=async(_input,init)=>{payloads.push(JSON.parse(init.body));return new Response('{"error":{"message":"Offline cap preflight","type":"invalid_request_error"}}',{status:400,headers:{"content-type":"application/json"}});};
 const handler=createHandler({providerId:config.providerId,modelId:config.modelId,maxOutputTokens:config.maxTokensPerTurn,reasoningEffort:"high",apiKey:"offline-placeholder",accessToken:"offline-placeholder",baseUrl:"https://offline.invalid",fetch:request});
 try{for await(const _part of handler.createMessage("Offline preflight.",[{role:"user",content:"No tool execution."}])){/* mock HTTP only */}}catch(error){if(!String(error).includes("Offline cap preflight"))throw error;}
 if(payloads.length!==1||payloads[0].max_output_tokens!==limit)throw Error("Output cap absent at provider boundary");
 process.stdout.write(JSON.stringify({runtime:dist,requestMaxOutputTokens:limit,offlineRequests:payloads.length,paidRequests:0})+"\n");
}
