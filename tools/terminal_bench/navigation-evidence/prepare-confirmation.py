"""Build the same current runtime and three isolated single-mechanism ablations."""
import hashlib,io,json,os,subprocess,tarfile
from pathlib import Path

repo=Path(__file__).resolve().parents[3]
assert os.environ.get('BLAME_STUDY_VARIANT')=='confirm2'
study=repo/'docs/experiments/light-harness-mechanism-confirmation-2026-10-13'
protocol=json.loads((study/'protocol.json').read_text())
base=protocol['currentHarnessCommit'];work=repo/'.blame/research/navigation-evidence-confirm2'
archive=subprocess.check_output(['git','archive',base,'packages/agent-runtime'],cwd=repo)
sha=lambda b:hashlib.sha256(b).hexdigest()
def invoke(argv,**kw):subprocess.run(argv,cwd=repo,check=True,**kw)
def change(source,path,before,after):
    file=source/path;text=file.read_text();assert text.count(before)==1,path
    file.write_text(text.replace(before,after))
for panel in ['current','f21','f22','f23']:
    source=work/'sources'/panel;assert not source.exists(),'Never overwrite a frozen source'
    source.mkdir(parents=True);invoke(['tar','-xf','-','-C',str(source)],input=archive)
    if panel=='f21':
        path='packages/agent-runtime/src/harness/light-edit.ts';file=source/path;text=file.read_text()
        start=text.index('class ScopedEditRecovery extends Error {');end=text.index('function patchFailureRecovery(',start)
        generic='''class ScopedEditRecovery extends Error {
  readonly recovery: string;
  constructor(message: string, resolved: ResolvedLightSymbol) {
    super(message);
    this.recovery = "No operations in this batch were applied. Every operation uses the original source, not earlier operations in the same batch. " +
      (patchFailureRecovery(message) ?? "Read the affected target and submit a focused edit against current source.");
  }
}

'''
        file.write_text(text[:start]+generic+text[end:])
    elif panel=='f22':
        change(source,'packages/agent-runtime/src/harness/light-contracts.ts','"symbol", "signature", "range"','"symbol", "range"')
        change(source,'packages/agent-runtime/src/harness/light-tools.ts','Use view signature on a symbol to inspect its declaration header without its body; read the symbol body before behavioral edits or rename. ','')
        path='packages/agent-runtime/src/harness/light-workspace.ts'
        change(source,path,'    if (view === "signature")\n      throw new Error("Signature view requires a symbol alias or path#qualifiedName. Read the file outline to choose a declaration.");\n','')
        change(source,path,'    if (input.view === "signature")\n      return this.readSignature(resolved, context);\n','')
        file=source/path;text=file.read_text();start=text.index('  private async readSignature(');end=text.index('  private async symbolOutline(',start)
        file.write_text(text[:start]+text[end:])
    elif panel=='f23':
        path='packages/agent-runtime/src/harness/light-task-runner.ts';file=source/path;text=file.read_text()
        start=text.index('      if (check.evidenceOrigin === "node_events" && check.counts)\n')
        end=text.index('      return { status: "ok", data:',start)
        file.write_text(text[:start]+text[end:])
    changed=[]
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if member.isfile() and tar.extractfile(member).read()!=(source/member.name).read_bytes():changed.append(member.name)
    assert changed==protocol['allowedAblationPaths'].get(panel,[]),changed
    diff=subprocess.run(['git','diff','--no-index','--','/dev/null',str(source/'packages/agent-runtime/src/production.ts')],capture_output=True)
    # The runtime production/budget code is identical in all arms.
    assert (source/'packages/agent-runtime/src/production.ts').read_bytes()==subprocess.check_output(['git','show',base+':packages/agent-runtime/src/production.ts'],cwd=repo)
    patch_parts=[]
    for path in changed:
        import difflib
        before=subprocess.check_output(['git','show',base+':'+path],cwd=repo).decode()
        patch_parts.extend(difflib.unified_diff(before.splitlines(True),(source/path).read_text().splitlines(True),fromfile='a/'+path,tofile='b/'+path))
    patch=''.join(patch_parts).encode();(study/(panel+'-ablation.patch')).write_bytes(patch)
    binding={'kind':'frozen-current' if panel=='current' else 'single-mechanism-ablation','baseCommit':base,
             'baseTree':subprocess.check_output(['git','rev-parse',base+'^{tree}'],cwd=repo,text=True).strip(),
             'archiveSha256':sha(archive),'changedTrackedPaths':changed,'patchFile':str((study/(panel+'-ablation.patch')).relative_to(repo)),
             'patchSha256':sha(patch),'productionSha256':sha((source/'packages/agent-runtime/src/production.ts').read_bytes())}
    (source/'source-binding.json').write_text(json.dumps(binding,indent=2)+'\n')
    (source/'packages/agent-runtime/node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
    invoke(['node','node_modules/typescript/bin/tsc','-p',str(source/'packages/agent-runtime/tsconfig.json')])
    invoke(['node',str(source/'packages/agent-runtime/scripts/copy-prompt.mjs')])
for panel in ['f21','f22','f23']:
    for arm,source_name in [('baseline',panel),('modified','current')]:
        source=work/'sources'/source_name
        invoke(['python','tools/terminal_bench/navigation-evidence/freeze.py',panel,arm,str(source/'packages/agent-runtime/dist'),base,str(source/'source-binding.json')])
print(json.dumps({'panels':3,'independentAblations':3,'paidRequests':0}))
