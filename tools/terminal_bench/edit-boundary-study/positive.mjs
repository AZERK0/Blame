// Independently authored local controls. Never supplied to a model.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function positive(root,id){
 async function replace(path,before,after){const p=join(root,path),s=await readFile(p,'utf8');assert.equal(s.split(before).length,2,path);await writeFile(p,s.replace(before,after));}
 if(id==='yaml-anchor-ranges'){
  await replace('src/nodes/Node.ts','  declare range?: Range | null','  declare range?: Range | null\n\n  /** Source anchor token offsets,including &; absent for constructed nodes. */\n  declare anchorRange?: [number, number]');
  await replace('src/nodes/Node.ts',"    if (this.range) copy.range = this.range.slice() as NodeBase['range']","    if (this.range) copy.range = this.range.slice() as NodeBase['range']\n    if (this.anchorRange) copy.anchorRange = [...this.anchorRange]");
  await replace('src/nodes/Collection.ts',"    if (this.range) copy.range = this.range.slice() as NodeBase['range']","    if (this.range) copy.range = this.range.slice() as NodeBase['range']\n    if (this.anchorRange) copy.anchorRange = [...this.anchorRange]");
  const p=join(root,'src/compose/compose-node.ts');let s=await readFile(p,'utf8');
  assert.equal(s.split('if (anchor) node.anchor = anchor.source.substring(1)').length,3);
  s=s.replaceAll('if (anchor) node.anchor = anchor.source.substring(1)',`if (anchor) {
        node.anchor = anchor.source.substring(1)
        node.anchorRange = [anchor.offset, anchor.offset + anchor.source.length]
      }`);
  s=s.replace("  if (anchor) {\n    node.anchor = anchor.source.substring(1)","  if (anchor) {\n    node.anchorRange = [anchor.offset, anchor.offset + anchor.source.length]\n    node.anchor = anchor.source.substring(1)");await writeFile(p,s);
 }else if(id==='fast-glob-dynamic-filter'){
  await replace('src/settings.ts',"import { FileSystemAdapter, Pattern } from './types';","import { Entry, FileSystemAdapter, Pattern } from './types';");
  await replace('src/settings.ts','export type Options = {','export type Options = {\n\tfilter?: (entry: Entry) => boolean;');
  await replace('src/settings.ts','export default class Settings {',"export default class Settings {\n\tpublic readonly filter: Options['filter'] = this._options.filter;");
  await replace('src/providers/filters/entry.ts','\t\tif (this._settings.unique && isMatched) {','\t\tif (isMatched && this._settings.filter && !this._settings.filter(entry)) {\n\t\t\treturn false;\n\t\t}\n\n\t\tif (this._settings.unique && isMatched) {');
  await replace('src/providers/filters/deep.ts','\t\treturn this._isSkippedByNegativePatterns(filepath, negativeRe);','\t\treturn this._isSkippedByNegativePatterns(filepath, negativeRe) &&\n\t\t\t(!this._settings.filter || this._settings.filter(entry));');
  await replace('src/readers/reader.ts','\tprotected _getFullEntryPath(filepath: string): string {',`\tprotected _guardFilterErrors(options: ReaderOptions, onError: (error: unknown) => void): ReaderOptions {
\t\tif (!this._settings.filter) return options;
\t\tlet failed = false;
\t\tconst guard = (filter: ReaderOptions['entryFilter'] | undefined) => (entry: Entry): boolean => {
\t\t\tif (failed) return false;
\t\t\ttry { return !filter || filter(entry); } catch (error) {
\t\t\t\tfailed = true;
\t\t\t\tonError(error);
\t\t\t\treturn false;
\t\t\t}
\t\t};
\t\treturn { ...options, entryFilter: guard(options.entryFilter), deepFilter: guard(options.deepFilter) };
\t}

\tprotected _getFullEntryPath(filepath: string): string {`);
  await replace('src/readers/async.ts','this._walkAsync(root, options, (error, entries) => {','this._walkAsync(root, this._guardFilterErrors(options, reject), (error, entries) => {');
  await replace('src/readers/stream.ts','\t\treturn this._walkStream(root, options);',`\t\tconst guarded = this._guardFilterErrors(options, error => {
\t\t\tqueueMicrotask(() => { stream.emit('error', error); stream.destroy(); });
\t\t});
\t\tconst stream = this._walkStream(root, guarded);
\t\treturn stream;`);
 }else throw Error(id);
}
