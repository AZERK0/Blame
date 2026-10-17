export function typeFixture(id){
 const v=`import * as v from '../library/src/index.ts';\n`;
 const r=`import * as r from '../packages/remeda/src/index.ts';\n`;
 if(id==='valibot-message-prefix'||id==='valibot-hide-input'){
 const key=id==='valibot-hide-input'?'hideInput':'messagePrefix'; const value=key==='hideInput'?'true':'"prefix"';
 return v+`v.setGlobalConfig({${key}:${value}});\nv.parse(v.string(), 'ok', {${key}:${value}});\nv.parseAsync(v.string(), 'ok', {${key}:${value}});\n// @ts-expect-error Invalid config type\nv.parse(v.string(),'ok',{${key}:123});\nconst output: string = v.parse(v.string(),'ok'); void output;\n`;
 }
 if(id==='valibot-fallback-when')return v+`const schema = v.fallback(v.string(),'fallback',(dataset,config)=>{ const lang:string|undefined=config.lang; void lang; return !!dataset.issues; });
const asyncSchema=v.fallbackAsync(v.string(),'fallback',async (dataset,config)=>!!dataset.issues && config.lang==='en');
const output:string=v.parse(schema,123); const promise:Promise<string>=v.parseAsync(asyncSchema,123); void output;void promise;
// @ts-expect-error Synchronous predicates cannot be async
v.fallback(v.string(),'fallback',async()=>true);
// @ts-expect-error Predicate returns boolean
v.fallbackAsync(v.string(),'fallback',()=>123);
`;
 if(id==='remeda-null-keys')return r+`const data=[1,2,3] as const;
const a=r.groupBy(data,x=>x===1?'yes':null); const b=r.countBy(data,x=>x===1?'yes':null); const c=r.indexBy(data,x=>x===1?'yes':undefined);
const d=r.indexBy((x:number)=>x===1?'yes':null)(data);
const e=r.countBy((x:number)=>x===1?'yes':undefined)(data);
const f=r.groupBy((x:number)=>x===1?'yes':null)(data);
// @ts-expect-error No null result key
void a.null;
// @ts-expect-error No undefined result key
void c.undefined;
void b;void d;void e;void f;
`;
 if(id==='remeda-stable-sum')return r+`const a:number=r.sum([1,2]);const b:bigint=r.sum([1n,2n] as const);const c:number=r.sumBy([1,2],x=>x);const d:number|undefined=r.mean([1,2]);const e:number=r.meanBy([1,2],x=>x);void a;void b;void c;void d;void e;
// @ts-expect-error Mixed bigint and number arrays are invalid
r.sum([1,2n]);
`;
 return r+`const pair: [[1,'x'],[2,'y']]=r.zip([1,2] as const,['x','y'] as const); const values:number[]=r.zipWith([1,2],[3,4],(a,b)=>a+b);void pair;void values;\n`;
}
