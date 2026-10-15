// Independently authored local controls, never copied into model workspaces.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function positive(root,kind){
 const replace=async(path,before,after)=>{const p=join(root,path),s=await readFile(p,'utf8');assert.equal(s.split(before).length,2,path+': unique anchor');await writeFile(p,s.replace(before,after));};
 if(kind==='choices'){
  for(const path of ['lib/option.js','lib/argument.js']){
   await replace(path,'choices(values) {','choices(values, config) {');
   await replace(path,'this.parseArg = (arg, previous) => {\n      if (!this.argChoices.includes(arg)) {','this.parseArg = (arg, previous) => {\n      const value = config?.caseInsensitive === true\n        ? this.argChoices.find(choice => choice.toLowerCase() === arg.toLowerCase()) : arg;\n      if (!this.argChoices.includes(value)) {');
   await replace(path,'return this._concatValue(arg, previous);','return this._concatValue(value, previous);');
   await replace(path,'      return arg;','      return value;');
   // JSDoc participates in the upstream checkJS suite.
   await replace(path,'   * @param {string[]} values\n','   * @param {string[]} values\n   * @param {{caseInsensitive?: boolean}} [config]\n');
  }
  const p=join(root,'typings/index.d.ts'),s=await readFile(p,'utf8');assert.equal(s.split('choices(values: readonly string[]): this;').length,3);
  await writeFile(p,s.replaceAll('choices(values: readonly string[]): this;','choices(values: readonly string[], config?: {caseInsensitive?: boolean} | null): this;'));
 }else if(kind==='hidden-arguments'){
  await replace('lib/argument.js','  argRequired() {','  /** @returns {boolean} */\n  get hidden() { return this._hidden ?? false; }\n  /** @param {boolean} value */\n  set hidden(value) { this._hidden = value; }\n  /** @param {boolean} [hide=true] @returns {Argument} */\n  hideHelp(hide = true) {\n    this.hidden = !!hide;\n    return this;\n  }\n\n  argRequired() {');
  await replace('lib/help.js','    if (cmd.registeredArguments.find((argument) => argument.description)) {\n      return cmd.registeredArguments;','    const visible = cmd.registeredArguments.filter(argument => !argument.hidden);\n    if (visible.find((argument) => argument.description)) {\n      return visible;');
  await replace('typings/index.d.ts','export class Argument {\n','export class Argument {\n  hidden: boolean;\n  hideHelp(hide?: boolean): this;\n');
 }else if(kind==='env-fallback'){
  await replace('lib/option.js','    this.envVar = undefined;','    this.envVar = undefined;\n    this.envFallbacks = [];');
  await replace('lib/option.js','  env(name) {\n    this.envVar = name;','  env(name, fallbackNames = []) {\n    this.envVar = name;\n    this.envFallbacks = fallbackNames.slice();');
  await replace('lib/option.js','   * @param {string} name\n','   * @param {string} name\n   * @param {readonly string[]} [fallbackNames]\n');
  await replace('lib/command.js',"this.on('optionEnv:' + oname, (val) => {","this.on('optionEnv:' + oname, (val) => {\n        const envVar = [option.envVar, ...option.envFallbacks].find(name => name in process.env) ?? option.envVar;");
  await replace('lib/command.js',"from env '${option.envVar}' is invalid.","from env '${envVar}' is invalid.");
  await replace('lib/command.js','      if (option.envVar && option.envVar in process.env) {','      const envVar = option.envVar && [option.envVar, ...option.envFallbacks].find(name => name in process.env);\n      if (envVar !== undefined) {');
  await replace('lib/command.js','this.emit(`optionEnv:${option.name()}`, process.env[option.envVar]);','this.emit(`optionEnv:${option.name()}`, process.env[envVar]);');
  await replace('lib/help.js','extraInfo.push(`env: ${option.envVar}`);',"extraInfo.push(`env: ${[option.envVar, ...option.envFallbacks].join(', ')}`);");
  await replace('typings/index.d.ts','  env(name: string): this;','  env(name: string, fallbackNames?: readonly string[]): this;');
 }else throw Error('Unknown positive kind');
}
