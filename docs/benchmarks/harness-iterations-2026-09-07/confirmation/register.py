import hashlib
import json
import shutil
import subprocess
import tomllib
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]
SELECTION = ROOT.parent / 'harness-iterations-20260907/holdout-selection.json'
UPSTREAM = ROOT.parent / 'upstream/terminal-bench-2'
ITERATION = ROOT.parent / 'terminal-bench-iteration-v2-20260907'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def metadata(name, seen, images):
    path = UPSTREAM / name
    spec = tomllib.loads((path / 'task.toml').read_text())
    return {'id': name, 'metadata': spec['metadata'], 'environment': spec['environment'],
            'agent': spec['agent'], 'verifier': spec['verifier'], 'seenBeforeCampaign': seen,
            'stratum': spec['metadata']['category'], 'image': images[name],
            'hashes': {str(file.relative_to(path)): digest(file) for file in sorted(path.rglob('*')) if file.is_file()}}


def agent(arm):
    return {'import_path': 'tools.terminal_bench.blame_agent:BlameAgent',
            'model_name': 'openai-codex/gpt-5.6-luna',
            'env': {'BLAME_BENCHMARK_HARNESS': 'cline' if arm == 'cline' else 'blame',
                    'BLAME_MODEL_ID': 'gpt-5.6-luna', 'BLAME_PROVIDER_ID': 'openai-codex',
                    'BLAME_REASONING_EFFORT': 'high', 'BLAME_MAX_ITERATIONS': '64',
                    'BLAME_TIMEOUT_SECONDS': '900', 'BLAME_ISOLATED_ENVIRONMENT': 'true',
                    'BLAME_BENCHMARK_BUNDLE': str(ROOT / 'runner-final.tgz')}}


def groups():
    blocks = [['regex-chess', 'cancel-async-tasks', 'sparql-university'],
              ['circuit-fibsqrt', 'query-optimize', 'overfull-hbox'],
              ['compile-compcert', 'polyglot-rust-c', 'sanitize-git-repo']]
    result = []
    for repetition in [1, 2]:
        for tasks in blocks if repetition == 1 else reversed(blocks):
            result.append({'id': f'batch-{len(result) + 1:02}', 'repetition': repetition,
                           'tasks': tasks if repetition == 1 else list(reversed(tasks)),
                           'armOrder': ['final', 'cline'] if repetition == 1 else ['cline', 'final'],
                           'trials': 6})
    return result


def write_config(group):
    name = group['id'] + '.json'
    save(name, {'job_name': group['id'], 'jobs_dir': str(ROOT / 'jobs'), 'n_attempts': 1,
         'n_concurrent_trials': 2, 'quiet': True, 'retry': {'max_retries': 0},
         'environment': {'type': 'docker', 'delete': True}, 'agents': [agent(arm) for arm in group['armOrder']],
         'tasks': [{'path': str(UPSTREAM / name)} for name in group['tasks']]})
    return digest(ROOT / name)


def main():
    assert not (ROOT / 'manifest.json').exists()
    previous = json.loads((ITERATION / 'manifest.json').read_text())
    selection = json.loads(SELECTION.read_text())
    images = json.loads((SELECTION.parent / 'holdout-image-preflight.json').read_text())
    image_by_task = {image['task']: image for image in images}
    tasks = [metadata(name, name in selection['diagnosticTasks'], image_by_task)
             for name in selection['freshTasks'] + selection['diagnosticTasks']]
    selected_groups = groups()
    assert {name for group in selected_groups for name in group['tasks']} == {task['id'] for task in tasks}
    target = ROOT / 'runner-final.tgz'
    shutil.copy2(ITERATION / 'runner-final.tgz', target)
    assert digest(target) == previous['bundles']['final']['sha256']
    configs = {group['id']: write_config(group) for group in selected_groups}
    save('manifest.json', {'registeredAt': datetime.now(timezone.utc).isoformat(),
         'bundles': {'final': {'path': str(target), 'sha256': digest(target)}},
         'groups': selected_groups, 'tasks': tasks, 'protocolSha256': digest(ROOT / 'protocol.md'),
         'adapterSha256': digest(WORKSPACE / 'tools/terminal_bench/blame_agent.py'),
         'sourceCommit': previous['sourceCommit'], 'upstreamCommit': previous['upstreamCommit'],
         'selectionSha256': digest(SELECTION), 'configHashes': configs,
         'registrationCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
         'initialDockerImages': subprocess.check_output(['docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'], text=True).splitlines()})
    print(json.dumps({'tasks': [task['id'] for task in tasks], 'trials': 36, 'bundle': digest(target)}))


if __name__ == '__main__':
    main()
