import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = 'mui__material-ui-23778'
IMAGE = 'blame-external-20260908:mui-material-ui-23778'
DESTINATION = ROOT / 'first-finish-replay'


def run(name, command, mounts, timeout):
    destination = DESTINATION / name
    destination.mkdir(parents=True, exist_ok=False)
    container = 'blame-mui-first-finish-' + name
    arguments = ['docker', 'run', '--rm', '--cpus=4', '--memory=8g', '--name', container]
    for source, target in mounts:
        arguments += ['-v', f'{source}:{target}']
    try:
        with (destination / 'container.log').open('wb') as stream:
            result = subprocess.run(arguments + [IMAGE, 'bash', '-lc', command],
                                    stdout=stream, stderr=subprocess.STDOUT, timeout=timeout)
        return result.returncode
    finally:
        subprocess.run(['docker', 'rm', '--force', container], capture_output=True)


def main():
    events = [json.loads(line) for line in (ROOT / 'progress.jsonl').read_text().split('\n') if line]
    assert events[-1]['kind'] == 'campaign_complete'
    active = subprocess.run(['docker', 'ps', '-q'], capture_output=True, check=True)
    assert not active.stdout.strip()
    baseline = run('baseline-build', 'cd packages/material-ui && yarn build', [], 160)
    destination = DESTINATION / 'captured-patch'
    mounts = [(ROOT / 'mui-first-finish.patch', '/captured.patch:ro'),
              (ROOT / 'tasks' / TASK / 'tests', '/tests:ro'),
              (destination, '/logs/verifier')]
    command = 'git apply --check /captured.patch && git apply /captured.patch && PYTHONPATH=/tests/vendor python3 /tests/grade.py'
    patched = run('captured-patch', command, mounts, 1850)
    evaluation = json.loads((destination / 'evaluation.json').read_text())
    result = {'baselineBuildExit': baseline, 'capturedPatchContainerExit': patched,
              'capturedPatchSha256': hashlib.sha256((ROOT / 'mui-first-finish.patch').read_bytes()).hexdigest(),
              'evaluation': evaluation, 'modelCalls': 0,
              'note': 'Fresh containers from the same frozen image; captured first-finish patch, never the reference fix.'}
    (DESTINATION / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'evaluation'}))
    print(json.dumps({'reward': evaluation['reward'], 'fullSuitePassed': evaluation['fullSuitePassed']}))


if __name__ == '__main__':
    main()
