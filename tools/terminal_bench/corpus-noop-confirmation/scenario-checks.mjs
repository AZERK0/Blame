import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';

const definitions = {
  'issue-tag': { path: 'src/issue-tag.ts', fn: 'normalizeIssueTag', checks: [
    ['ASCII tag normalization', 'm.normalizeIssueTag("  A--B / 09  ")==="a_b_09" && m.normalizeIssueTag("A___B")==="a_b" && m.normalizeIssueTag("Ready")==="ready"'],
    ['empty and non-ASCII fallback', '["","  ","___","é"].every(s=>m.normalizeIssueTag(s)==="untagged") && m.normalizeIssueTag("Été")==="t" && m.TAG_LABEL==="Tag"'],
  ] },
  'priority-score': { path: 'src/priority.ts', fn: 'priorityForScore', checks: [
    ['priority boundaries', '[0,32,33,65,66,100].every((n,i)=>m.priorityForScore(n)===["low","low","normal","normal","high","high"][i]) && m.PRIORITY_LABEL==="Priority"'],
    ['invalid scores rejected', '[-1,101,.5,NaN,Infinity,-Infinity].every(n=>rangeError(()=>m.priorityForScore(n)))'],
  ] },
  'receipt-summary': { path: 'src/receipt.ts', fn: 'summarizeReceipt', checks: [
    ['receipt sums and empty input', '(()=>{const r=m.summarizeReceipt([{priceCents:125,quantity:2},{priceCents:50,quantity:3}]),e=m.summarizeReceipt([]);return r.count===5&&r.totalCents===400&&e.count===0&&e.totalCents===0;})()'],
    ['invalid and overflowing values rejected', '[-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1].every(n=>rangeError(()=>m.summarizeReceipt([{priceCents:n,quantity:1}]))&&rangeError(()=>m.summarizeReceipt([{priceCents:1,quantity:n}]))) && rangeError(()=>m.summarizeReceipt([{priceCents:Number.MAX_SAFE_INTEGER,quantity:2}])) && rangeError(()=>m.summarizeReceipt([{priceCents:Number.MAX_SAFE_INTEGER,quantity:1},{priceCents:1,quantity:1}])) && rangeError(()=>m.summarizeReceipt([{priceCents:0,quantity:Number.MAX_SAFE_INTEGER},{priceCents:0,quantity:1}]))'],
    ['readonly inputs preserved', '(()=>{const a=Object.freeze([{priceCents:5,quantity:2},{priceCents:0,quantity:0}].map(Object.freeze));const r=m.summarizeReceipt(a);return r.count===2&&r.totalCents===10&&a[0].priceCents===5&&a[0].quantity===2&&a[1].quantity===0;})()'],
  ] },
};
const parse = (path, source) => ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
const find = (ast, name) => ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
const compact = (node, ast) => node?.getText(ast).replace(/\s/gu, '');
export async function scenarioChecks(id, workspace) {
  const def = definitions[id];
  if (!def) throw new Error('Unknown no-op confirmation ' + id);
  const source = await readFile(join(workspace, def.path), 'utf8');
  const original = await readFile(new URL('./fixture/' + def.path, import.meta.url), 'utf8');
  const ast = parse(def.path, source), initial = parse(def.path, original);
  const fn = find(ast, def.fn), initialFn = find(initial, def.fn);
  const outside = (text, node) => text.slice(0, node.getStart()) + text.slice(node.end);
  const retained = Boolean(fn?.body && fn.modifiers?.some(n => n.kind === ts.SyntaxKind.ExportKeyword) &&
    compact(fn.type, ast) === compact(initialFn.type, initial) && fn.parameters.length === initialFn.parameters.length &&
    fn.parameters.every((n,i) => compact(n, ast) === compact(initialFn.parameters[i], initial)) &&
    outside(source, fn) === outside(original, initialFn));
  const multiline = Boolean(fn?.body && fn.body.statements.length && fn.body.statements.every(n => {
    const position = n.getStart(ast), lineStart = source.lastIndexOf('\n', position - 1) + 1;
    return source.slice(lineStart, position) === '  ';
  }));
  const structural = [{ name: 'public contract and outside code retained', passed: retained },
    { name: 'multiline body with two-space top-level statements', passed: multiline }];
  try {
    const module = { exports: {} }, context = createContext({ module, exports: module.exports });
    const output = ts.transpileModule(source, { fileName: def.path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    new Script(output).runInContext(context, { timeout: 1000 });
    context.m = module.exports;
    new Script('const rangeError=fn=>{try{fn();return false;}catch(e){return e?.name==="RangeError";}};').runInContext(context, { timeout: 1000 });
    return [...structural, ...def.checks.map(([name, expression]) => {
      try { return { name, passed: Boolean(new Script(expression).runInContext(context, { timeout: 1000 })) }; }
      catch { return { name, passed: false }; }
    })];
  } catch { return [...structural, ...def.checks.map(([name]) => ({ name, passed: false }))]; }
}
export function scenarioHarnessChecks() { return []; }
