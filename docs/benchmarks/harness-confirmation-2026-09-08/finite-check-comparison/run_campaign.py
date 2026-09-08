import hashlib
import json
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]
MANIFEST = json.loads((ROOT / 'manifest.json').read_text())
SEEN = set()



def log(kind, **values):
    record = {'at': datetime.now(timezone.utc).isoformat(), 'kind': kind, **values}
    encoded = json.dumps(record)
    print(encoded, flush=True)
    with (ROOT / 'progress.jsonl').open('a') as stream:
        stream.write(encoded + '\n')


def docker(*args):
    return subprocess.run(['docker', *args], capture_output=True, text=True, timeout=30)


def check_integrity(group):
    expected = {ROOT / 'protocol.md': MANIFEST['protocolSha256'],
                ROOT / (group['id'] + '.json'): MANIFEST['configHashes'][group['id']],
                WORKSPACE / 'tools/terminal_bench/blame_agent.py': MANIFEST['adapterSha256']}
    expected.update({Path(row['path']): row['sha256'] for row in MANIFEST['bundles'].values()})
    expected[ROOT / 'eligible-tasks.json'] = MANIFEST['selectionSha256']
    for path, sha in expected.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, path
    for task in MANIFEST['tasks']:
        for name, sha in task['hashes'].items():
            path = Path(task['path']) / name
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, path


def observe(group):
    counts = {}
    for path in sorted((ROOT / 'jobs' / group['id']).glob('*/result.json')):
        try:
            result = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        task = result['task_name'].rsplit('/', 1)[-1]
        counts[task] = counts.get(task, 0) + 1
        if str(path) in SEEN:
            continue
        SEEN.add(str(path))
        env = json.loads((path.parent / 'config.json').read_text())['agent']['env']
        arm = 'cline' if env['BLAME_BENCHMARK_HARNESS'] == 'cline' else Path(env['BLAME_BENCHMARK_BUNDLE']).stem.removeprefix('runner-')
        reward = ((result.get('verifier_result') or {}).get('rewards') or {}).get('reward')
        exception = (result.get('exception_info') or {}).get('exception_type')
        log('trial_done', group=group['id'], task=task, arm=arm, reward=reward,
            exception=exception, trial=path.parent.name)
    return sum(counts.values())


def check_images():
    for task in MANIFEST['tasks']:
        image = json.loads(docker('image', 'inspect', task['imageTag']).stdout)[0]
        assert image['Id'] == task['image']['imageId'], 'Frozen application image changed'


def run_group(group):
    check_integrity(group)
    engine_root = docker('info', '--format', '{{.DockerRootDir}}').stdout.strip()
    assert '/blame-benchmark-docker-20260907/' in engine_root, 'Dedicated benchmark daemon required'
    assert shutil.disk_usage(engine_root).free > 30 * 1024**3, 'Less than 30 GiB Docker storage free'
    assert shutil.disk_usage(WORKSPACE).free > 4 * 1024**3, 'Less than 4 GiB workspace disk free'
    check_images()
    log('group_start', group=group['id'], repetition=group['repetition'], tasks=group['tasks'])
    process = run_harbor(group)
    verify_group(group, process)


def run_harbor(group):
    command = [str(WORKSPACE / '.blame/terminal-bench-venv/bin/harbor'), 'run',
               '--config', str(ROOT / (group['id'] + '.json')), '--env-file', '.env.terminal-bench']
    environment = dict(os.environ, PYTHONPATH=str(WORKSPACE))
    with (ROOT / (group['id'] + '.log')).open('w') as stream:
        process = subprocess.Popen(command, cwd=WORKSPACE, env=environment, stdout=stream, stderr=subprocess.STDOUT)
        while process.poll() is None:
            observe(group)
            time.sleep(10)
    return process


def verify_group(group, process):
    count = observe(group)
    log('group_end', group=group['id'], trials=count, exitCode=process.returncode)
    assert count == group['trials'], 'Incomplete group requires infrastructure diagnosis'
    assert process.returncode == 0, 'Harbor process failed'
    results = [json.loads(path.read_text()) for path in (ROOT / 'jobs' / group['id']).glob('*/result.json')]
    assert any((result.get('agent_execution') or {}).get('started_at') for result in results), 'No agent started; stop on environment failure'


def main():
    assert not (ROOT / 'progress.jsonl').exists(), 'Do not silently repeat an existing campaign'
    for group in MANIFEST['groups']:
        run_group(group)
    log('campaign_complete', trials=len(SEEN))


if __name__ == '__main__':
    main()
