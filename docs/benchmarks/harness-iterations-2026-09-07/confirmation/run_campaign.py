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
REMOVED = set()


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
    for path, sha in expected.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, path
    for task in MANIFEST['tasks']:
        for name, sha in task['hashes'].items():
            path = ROOT.parent / 'upstream/terminal-bench-2' / task['id'] / name
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha, path


def cleanup(group, counts):
    for task in MANIFEST['tasks']:
        name, image = task['id'], task['environment']['docker_image']
        if counts.get(name) != 2 or (group, name) in REMOVED or image in MANIFEST['initialDockerImages']:
            continue
        if docker('ps', '-aq', '--filter', f'ancestor={image}').stdout.strip():
            continue
        digests = docker('image', 'inspect', '--format', '{{json .RepoDigests}}', image).stdout.strip()
        result = docker('image', 'rm', image)
        if result.returncode == 0:
            REMOVED.add((group, name))
            log('image_removed', group=group, task=name, image=image, digests=digests)


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
    cleanup(group['id'], counts)
    return sum(counts.values())


def run_group(group):
    check_integrity(group)
    assert shutil.disk_usage('/').free > 3 * 1024**3, 'Less than 3 GiB root disk free before group'
    assert shutil.disk_usage(WORKSPACE).free > 4 * 1024**3, 'Less than 4 GiB workspace disk free'
    log('group_start', group=group['id'], repetition=group['repetition'], tasks=group['tasks'])
    command = [str(WORKSPACE / '.blame/terminal-bench-venv/bin/harbor'), 'run',
               '--config', str(ROOT / (group['id'] + '.json')), '--env-file', '.env.terminal-bench']
    environment = dict(os.environ, PYTHONPATH=str(WORKSPACE))
    with (ROOT / (group['id'] + '.log')).open('w') as stream:
        process = subprocess.Popen(command, cwd=WORKSPACE, env=environment, stdout=stream, stderr=subprocess.STDOUT)
        while process.poll() is None:
            observe(group)
            time.sleep(10)
    count = observe(group)
    log('group_end', group=group['id'], trials=count, exitCode=process.returncode)
    assert count == group['trials'], 'Incomplete group requires infrastructure diagnosis'
    assert process.returncode == 0, 'Harbor process failed'


def main():
    assert not (ROOT / 'progress.jsonl').exists(), 'Do not silently repeat an existing campaign'
    for group in MANIFEST['groups']:
        run_group(group)
    log('campaign_complete', trials=len(SEEN))


if __name__ == '__main__':
    main()
