// Read-only public EventEmitter-origin cases; no file edits or model calls.
const keys=['F30_ORIGIN_PRIMARY','F30_ORIGIN_BACKUP','F30_ORIGIN_LAST'];
function probe(api,useFallback,selectFallback){
 const saved=keys.map(k=>process.env[k]);
 try{
  keys.forEach(k=>delete process.env[k]);process.env[keys[selectFallback?1:0]]='invalid';process.env[keys[2]]='allowed';
  const option=new api.Option('--mode <value>').env(keys[0],useFallback?keys.slice(1):undefined).choices(['allowed']);
  const command=new api.Command().exitOverride().configureOutput({writeOut(){},writeErr(){}}).addOption(option),events=[];
  command.prependListener('optionEnv:mode',(...args)=>{events.push({args,primary:option.envVar});delete process.env[keys[selectFallback?1:0]];});
  let error=null;try{command.parse([],{from:'user'});}catch(e){error={code:e.code??null,message:e.message};}
  const expected=keys[selectFallback?1:0];
  return {useFallback,selectFallback,expected,events,error,passed:events.length===1&&events[0].args.length===1&&events[0].args[0]==='invalid'&&events[0].primary===keys[0]&&error?.code==='commander.invalidArgument'&&error.message.includes("from env '"+expected+"'")};
 }finally{keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}
}
exports.probe=probe;
