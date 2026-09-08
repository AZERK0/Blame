import hashlib
import json
import subprocess
import tarfile
import tomllib
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]
UPSTREAM = ROOT.parent / 'upstream/terminal-bench-2'
SELECTION = json.loads((ROOT / 'selection.json').read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def task_metadata(name, images):
    path = UPSTREAM / name
    spec = tomllib.loads((path / 'task.toml').read_text())
    return {'id': name, 'metadata': spec['metadata'], 'environment': spec['environment'],
            'agent': spec['agent'], 'verifier': spec['verifier'],
            'seenBeforeCampaign': name in SELECTION['diagnosticTasks'],
            'stratum': spec['metadata']['category'], 'image': images[name],
            'hashes': {str(file.relative_to(path)): digest(file)
                       for file in sorted(path.rglob('*')) if file.is_file()}}


def agent(arm):
    bundle = 'before' if arm == 'before' else 'final'
    return {'import_path': 'tools.terminal_bench.blame_agent:BlameAgent',
            'model_name': 'openai-codex/gpt-5.6-luna',
            'env': {'BLAME_BENCHMARK_HARNESS': 'cline' if arm == 'cline' else 'blame',
                    'BLAME_MODEL_ID': 'gpt-5.6-luna', 'BLAME_PROVIDER_ID': 'openai-codex',
                    'BLAME_REASONING_EFFORT': 'high', 'BLAME_MAX_ITERATIONS': '64',
                    'BLAME_TIMEOUT_SECONDS': '900', 'BLAME_ISOLATED_ENVIRONMENT': 'true',
                    'BLAME_BENCHMARK_BUNDLE': str(ROOT / f'runner-{bundle}.tgz')}}


def groups():
    tasks = SELECTION['diagnosticTasks'] + SELECTION['freshTasks']
    blocks = [tasks[:3], tasks[3:]]
    result = []
    for repetition in [1, 2]:
        for block in blocks if repetition == 1 else reversed(blocks):
            result.append({'id': f'batch-{len(result) + 1:02}', 'repetition': repetition,
                           'tasks': block if repetition == 1 else list(reversed(block)),
                           'armOrder': ['before', 'final', 'cline'] if repetition == 1
                           else ['cline', 'final', 'before'], 'trials': 9})
    return result


def write_config(group):
    name = group['id'] + '.json'
    save(name, {'job_name': group['id'], 'jobs_dir': str(ROOT / 'jobs'), 'n_attempts': 1,
                'n_concurrent_trials': 2, 'quiet': True, 'retry': {'max_retries': 0},
                'environment': {'type': 'docker', 'delete': True},
                'agents': [agent(arm) for arm in group['armOrder']],
                'tasks': [{'path': str(UPSTREAM / task)} for task in group['tasks']]})
    return digest(ROOT / name)


def bundle(arm):
    path = ROOT / f'runner-{arm}.tgz'
    with tarfile.open(path) as archive:
        provenance = json.loads(archive.extractfile('./benchmark-provenance.json').read())
    return {'path': str(path), 'sha256': digest(path), 'provenance': provenance}


def main():
    assert not (ROOT / 'manifest.json').exists()
    images = {item['task']: item for item in json.loads((ROOT / 'image-preflight.json').read_text())}
    assert all(item['matched'] for item in images.values())
    selected_groups = groups()
    bundles = {arm: bundle(arm) for arm in ['before', 'final']}
    save('manifest.json', {'registeredAt': datetime.now(timezone.utc).isoformat(),
         'bundles': bundles, 'groups': selected_groups,
         'tasks': [task_metadata(name, images) for name in SELECTION['diagnosticTasks'] + SELECTION['freshTasks']],
         'protocolSha256': digest(ROOT / 'protocol.md'),
         'adapterSha256': digest(WORKSPACE / 'tools/terminal_bench/blame_agent.py'),
         'sourceCommit': bundles['final']['provenance']['commit'],
         'upstreamCommit': subprocess.check_output(['git', '-C', str(UPSTREAM), 'rev-parse', 'HEAD'], text=True).strip(),
         'selectionSha256': digest(ROOT / 'selection.json'),
         'configHashes': {group['id']: write_config(group) for group in selected_groups},
         'registrationCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
         'initialDockerImages': subprocess.check_output(['docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'], text=True).splitlines()})
    print(json.dumps({'trials': 36, 'bundles': bundles}))


if __name__ == '__main__':
    main()
