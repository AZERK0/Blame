// Opt-in auxiliary members: old task registrations never acquire new permissions.
import {createRequire} from "node:module";
const ts=createRequire(new URL("../../../packages/agent-runtime/package.json",import.meta.url))("typescript");
export function stripPermittedMembers(text,permissions={}) {
  const source=ts.createSourceFile("source.ts",text,ts.ScriptTarget.Latest,true),ranges=[];
  if(source.parseDiagnostics.length)throw Error("Invalid source syntax");
  for(const [name,members] of Object.entries(permissions)) {
    const declarations=source.statements.filter(n=>(ts.isTypeAliasDeclaration(n)||ts.isInterfaceDeclaration(n))&&n.name.text===name);
    if(declarations.length!==1)throw Error("Missing/ambiguous auxiliary type "+name);
    const declaration=declarations[0],type=ts.isTypeAliasDeclaration(declaration)?declaration.type:declaration;
    if(!type.members)throw Error("Expected member-bearing type "+name);
    for(const member of type.members) {
      const permission=members[member.name?.getText(source)];if(!permission)continue;
      if(!member.questionToken)throw Error("Auxiliary member must be optional");
      if(permission==="boolean"&&member.type?.kind!==ts.SyntaxKind.BooleanKeyword)throw Error("Expected boolean auxiliary member");
      if(permission==="callable"&&!ts.isMethodSignature(member)&&!ts.isFunctionTypeNode(member.type))throw Error("Expected callable auxiliary member");
      ranges.push([member.getStart(source),member.end]);
    }
  }
  for(const [start,end] of ranges.sort((a,b)=>b[0]-a[0]))text=text.slice(0,start)+text.slice(end);
  return text;
}
