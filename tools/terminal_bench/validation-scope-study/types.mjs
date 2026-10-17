export function typeFixture(id){
 if(id==='remeda-take-counts')return `import {take,pipe} from '../packages/remeda/src/index.ts';
const input = [1,2] as const;
const direct: (1|2)[] = take(input,0.5);
const lazy: (1|2)[] = pipe(input,take(Infinity));
void [direct,lazy];\n`;
 if(id==='valibot-summary-format')return `import {summarize,string,safeParse} from '../library/src/index.ts';
const result=safeParse(string(),123);
if(!result.success){const text:string=summarize(result.issues,{bullet:'',indent:'',includePath:false});void text;}
// @ts-expect-error Non-boolean path flags are invalid.
summarize([] as never,{includePath:'yes'});\n`;
 return `import * as v from '../library/src/index.ts';
const schema=v.pipe(v.string(),v.transform(x=>x.length));
const parsed:number=v.parser(schema)('abc',{abortEarly:false,message:undefined});
const parsedAsync:Promise<number>=v.parserAsync(schema)('abc',{lang:'fr'});
const safe:v.SafeParseResult<typeof schema>=v.safeParser(schema)('abc',{abortEarly:false});
const safeAsync:Promise<v.SafeParseResult<typeof schema>>=v.safeParserAsync(schema)('abc',{lang:'fr'});
// @ts-expect-error Invalid configuration type must stay rejected.
v.parser(schema)('abc',{abortEarly:'no'});
void [parsed,parsedAsync,safe,safeAsync];\n`;
}
