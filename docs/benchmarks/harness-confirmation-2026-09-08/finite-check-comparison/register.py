import hashlib
import json
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def task_configuration(task):
    directory = ROOT / 'tasks' / task['id']
    image = json.loads((ROOT / 'preflight' / task['id'] / 'image.json').read_text())
    environment = directory / 'environment'
    environment.mkdir(exist_ok=True)
    (environment / 'Dockerfile').write_text(f'FROM {image["imageId"]}\n')
    configuration = ('schema_version = "1.1"\nartifacts = []\n\n[task]\n'
                     f'name = "external-app/{task["id"]}"\n'
                     'description = "Repair a real issue in an external application repository."\n'
                     '[metadata]\ncategory = "software-engineering"\n'
                     '[agent]\ntimeout_sec = 900.0\n[verifier]\ntimeout_sec = 1800.0\n'
                     '[environment]\nbuild_timeout_sec = 600.0\n'
                     f'docker_image = "{task["image"]}"\n'
                     'cpus = 4\nmemory_mb = 8192\nstorage_mb = 15360\nallow_internet = true\n')
    (directory / 'task.toml').write_text(configuration)
    return dict(task, path=str(directory), imageTag=task['image'], image=image, seenBeforeCampaign=True,
                stratum='csharp' if task['id'].startswith(('serilog', 'avalonia')) else
                'react-javascript' if task['id'].startswith('mui') else
                'typescript' if task['id'].startswith('vuejs') else 'java',
                hashes={str(path.relative_to(directory)): digest(path)
                        for path in sorted(directory.rglob('*')) if path.is_file() and '__pycache__' not in path.parts})


def agent(arm):
    return {'import_path': 'tools.terminal_bench.blame_agent:BlameAgent',
            'model_name': 'openai-codex/gpt-5.6-luna',
            'env': {'BLAME_BENCHMARK_HARNESS': 'cline' if arm == 'cline' else 'blame',
                    'BLAME_MODEL_ID': 'gpt-5.6-luna', 'BLAME_PROVIDER_ID': 'openai-codex',
                    'BLAME_REASONING_EFFORT': 'high', 'BLAME_MAX_ITERATIONS': '64',
                    'BLAME_TIMEOUT_SECONDS': '900', 'BLAME_ISOLATED_ENVIRONMENT': 'true',
                    'BLAME_BENCHMARK_BUNDLE': str(ROOT / ('runner-before.tgz' if arm == 'before' else 'runner-final.tgz'))}}


def groups(tasks):
    blocks = [tasks[index:index + 3] for index in range(0, len(tasks), 3)]
    result = []
    for repetition in [1, 2]:
        for block in blocks if repetition == 1 else reversed(blocks):
            result.append({'id': f'batch-{len(result) + 1:02}', 'repetition': repetition,
                           'tasks': block if repetition == 1 else list(reversed(block)),
                           'armOrder': ['before', 'final', 'cline'] if repetition == 1 else ['cline', 'final', 'before'],
                           'trials': 3 * len(block)})
    return result


def write_config(group):
    name = group['id'] + '.json'
    save(name, {'job_name': group['id'], 'jobs_dir': str(ROOT / 'jobs'), 'n_attempts': 1,
                'n_concurrent_trials': 2, 'quiet': True, 'retry': {'max_retries': 0},
                'environment': {'type': 'docker', 'delete': True},
                'agents': [agent(arm) for arm in group['armOrder']],
                'tasks': [{'path': str(ROOT / 'tasks' / task)} for task in group['tasks']]})
    return digest(ROOT / name)


def verified_selection():
    selected = json.loads((ROOT / 'eligible-tasks.json').read_text())
    for task in selected:
        directory = ROOT / 'preflight' / task['id']
        baseline = json.loads((directory / 'baseline/evaluation.json').read_text())
        reference = json.loads((directory / 'reference/evaluation.json').read_text())
        assert baseline['reward'] == 0 and reference['reward'] == 1
        assert baseline['failToPassPassed'] < baseline['failToPassTotal']
        assert reference['failToPassTotal'] > 0
        assert baseline['failedRequired'] and not baseline['missingRequired']
        assert baseline['passToPassPassed'] == baseline['passToPassTotal']
        assert baseline['suiteExitCode'] != 124 and not baseline.get('verifierError')
    return selected


def bundle(arm):
    path = ROOT / f'runner-{arm}.tgz'
    with tarfile.open(path) as archive:
        provenance = json.loads(archive.extractfile('./benchmark-provenance.json').read())
    return {'path': str(path), 'sha256': digest(path), 'provenance': provenance}


def main():
    assert not (ROOT / 'manifest.json').exists(), 'Do not replace a frozen manifest'
    tasks = [task_configuration(task) for task in verified_selection()]
    selected_groups = groups([task['id'] for task in tasks])
    payload = bundle('final')
    save('manifest.json', {'registeredAt': datetime.now(timezone.utc).isoformat(),
         'bundles': {'final': payload, 'before': bundle('before')}, 'groups': selected_groups, 'tasks': tasks,
         'protocolSha256': digest(ROOT / 'protocol.md'),
         'adapterSha256': digest(WORKSPACE / 'tools/terminal_bench/blame_agent.py'),
         'sourceCommit': payload['provenance']['commit'],
         'configHashes': {group['id']: write_config(group) for group in selected_groups},
         'selectionSha256': digest(ROOT / 'eligible-tasks.json'),
         'registrationCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()})
    print(json.dumps({'trials': sum(group['trials'] for group in selected_groups), 'tasks': len(tasks)}))


if __name__ == '__main__':
    main()
