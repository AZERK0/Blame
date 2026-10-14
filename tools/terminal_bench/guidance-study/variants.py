"""Build source-pinned single-factor variants; never alter the production tree."""
from pathlib import Path
import difflib,hashlib,json,re,subprocess,tarfile,io,shutil,sys
repo=Path(__file__).resolve().parents[3]
work=repo/'.blame/research/guidance-f28'
study=repo/'docs/experiments/light-harness-guidance-f28-2026-10-15'
parent='50680158a5807dfa29d0862567a23b6be200e470'
candidate='5f31042529dd5c633909267df27398418a49ebbd'
prefix='packages/agent-runtime/'
sha=lambda x:hashlib.sha256(x).hexdigest()
def original(path,rev=parent):
    return subprocess.check_output(['git','show',f'{rev}:{prefix}{path}'],cwd=repo).decode()
def delta(path):
    return subprocess.check_output(['git','diff','--unified=0',parent,candidate,'--',prefix+path],cwd=repo,text=True)
def selected(path,accept):
    lines=original(path).splitlines(keepends=True)
    hunks=re.split(r'(?=^@@ )',delta(path),flags=re.M)[1:]
    for hunk in reversed(hunks):
        if not accept(hunk):continue
        match=re.match(r'@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@',hunk)
        start,count=int(match[1]),int(match[2] or 1)
        at=start if count==0 else start-1
        old=''.join(line[1:] for line in hunk.splitlines(keepends=True)[1:] if line.startswith('-'))
        new=''.join(line[1:] for line in hunk.splitlines(keepends=True)[1:] if line.startswith('+'))
        assert ''.join(lines[at:at+count])==old,(path,hunk)
        lines[at:at+count]=new.splitlines(keepends=True)
    return ''.join(lines)
def replace(text,old,new):
    assert text.count(old)==1,old
    return text.replace(old,new)

groups={name:{} for name in ['scope','references','rename','reading','reporting','patch']}
groups['scope']['src/harness/light-navigation.ts']=original('src/harness/light-navigation.ts',candidate)
groups['references']['src/harness/light-reference-search.ts']=original('src/harness/light-reference-search.ts',candidate)
groups['rename']['src/harness/light-semantic-rename.ts']=original('src/harness/light-semantic-rename.ts',candidate)
for path in ['check-observation.ts','light-validation-report.ts','light-task-runner.ts','light-completion.ts','light-finish-service.ts']:
    groups['reporting']['src/harness/'+path]=original('src/harness/'+path,candidate)
groups['reporting']['src/prompt/code-agent-system.txt']=original('src/prompt/code-agent-system.txt',candidate)
for name,markers in {
    'scope':['emptySearchScope'], 'references':['this.references.recovery'],
    'reading':['truncatedReadGuidance'],
    'reporting':['currentValidationReport','specialReadResult'],
}.items():groups[name]['src/harness/light-workspace.ts']=selected('src/harness/light-workspace.ts',lambda h:any(s in h for s in markers))
for name in ['scope','patch']:
    groups[name]['src/harness/light-contracts.ts']=selected('src/harness/light-contracts.ts',lambda h:('scope:' in h)==(name=='scope'))
is_rename=lambda h:any(s in h for s in ['semanticRename','Compiler-derived identifier edits'])
groups['rename']['src/harness/light-edit.ts']=selected('src/harness/light-edit.ts',is_rename)
groups['patch']['src/harness/light-edit.ts']=selected('src/harness/light-edit.ts',lambda h:not is_rename(h))
tools=original('src/harness/light-tools.ts')
groups['scope']['src/harness/light-tools.ts']=replace(replace(tools,'Whitespace separates search terms;','Whitespace separates query terms;'),
 'Scope accepts paths and *, **, ?, or {a,b} globs.','Scope accepts paths and *, **, ?, or {a,b} globs; multiple scopes use an array such as [\\"src\\",\\"spec\\"]. Spaces in a scope string are literal.')
groups['references']['src/harness/light-tools.ts']=replace(tools,'Other queries find lexical candidates.','Bare-name fallback proposes nextSearches; choose the intended declaration. Other queries find lexical candidates.')
groups['reading']['src/harness/light-tools.ts']=replace(tools,'otherwise omit view for automatic raw/outline routing.','otherwise omit view for automatic raw/outline routing. Truncated reads propose nextRead and outline routes without granting unseen coverage.')
report_tools=replace(tools,'@changes, or @capabilities.','@changes, @checks, or @capabilities. @checks lists current-source check observations without running them; unknown counts stay null.')
report_tools=replace(report_tools,'Returns bounded output and code/environment diagnostics.','Test results include reporting counters; null is unknown and pending is distinct from skipped. Returns bounded output and code/environment diagnostics.')
groups['reporting']['src/harness/light-tools.ts']=report_tools

if sys.argv[1:]!=['build']:raise SystemExit('Use build')
assert not (work/'frozen').exists(),'Never overwrite a frozen study'
bindings=[]
for arm in ['baseline',*groups,'bundle']:
    rev=candidate if arm=='bundle' else parent
    archive=subprocess.check_output(['git','archive',rev,prefix.rstrip('/')],cwd=repo)
    root=work/'sources'/arm;root.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(archive)) as t:t.extractall(root,filter='data')
    package=root/prefix
    for path,text in groups.get(arm,{}).items():(package/path).write_text(text)
    patch=''
    for path in sorted(groups.get(arm,{})):
        try:old=original(path)
        except subprocess.CalledProcessError:old=''
        patch+=''.join(difflib.unified_diff(old.splitlines(keepends=True),groups[arm][path].splitlines(keepends=True),fromfile='a/'+prefix+path,tofile='b/'+prefix+path))
    if arm not in ('baseline','bundle'):(study/(arm+'.patch')).write_text(patch)
    (package/'node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
    (package/'research-tsconfig.json').write_text(json.dumps({'extends':'./tsconfig.json','exclude':['dist','src/**/*.test.ts','src/**/light-agent-guidance-fixture.ts']})+'\n')
    subprocess.run(['node',str(repo/'node_modules/typescript/bin/tsc'),'-p',str(package/'research-tsconfig.json')],cwd=repo,check=True)
    subprocess.run(['node',str(package/'scripts/copy-prompt.mjs')],cwd=repo,check=True)
    frozen=work/'frozen/f28'/arm
    for name in ['agent-runtime','benchmark-runner']:
        dest=frozen/name;dest.mkdir(parents=True)
        source=package/'dist' if name=='agent-runtime' else repo/'packages/benchmark-runner/dist'
        shutil.copytree(source,dest/'dist')
        (dest/'package.json').write_text('{"type":"module","exports":"./dist/index.js"}\n')
        if name=='agent-runtime':(dest/'node_modules').symlink_to(repo/'packages/agent-runtime/node_modules',target_is_directory=True)
        else:
            (dest/'node_modules/@blame').mkdir(parents=True)
            (dest/'node_modules/@blame/agent-runtime').symlink_to(frozen/'agent-runtime',target_is_directory=True)
    source_files={str(p.relative_to(package)):sha(p.read_bytes()) for p in sorted((package/'src').rglob('*')) if p.is_file() and not p.name.endswith('.test.ts') and 'guidance-fixture' not in p.name}
    binding={'arm':arm,'sourceCommit':rev,'archiveSha256':sha(archive),'patchSha256':sha(patch.encode()),'changedPaths':sorted(groups.get(arm,{})),'sourceHashes':source_files}
    (frozen/'version.json').write_text(json.dumps(binding,indent=2)+'\n');bindings.append(binding)
    print(json.dumps({'frozen':arm,'changedPaths':binding['changedPaths']}),flush=True)
(study/'variant-sources.json').write_text(json.dumps(bindings,indent=2)+'\n')
