import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DESTINATION = ROOT / 'vue-suspense-replay'
TASK = 'vuejs__core-11491'
IMAGE = 'blame-external-20260908:vuejs-core-11491'
PATCH = next(ROOT.glob('jobs/*/*UoqFMSs/verifier/agent.diff'))
FAILURES = {
    'packages/runtime-core/__tests__/components/Suspense.spec.ts > Suspense > branch switch to 3rd branch before resolve',
    'packages/runtime-core/__tests__/components/Suspense.spec.ts > Suspense > nested suspense (w/ suspensible) switch several times before parent suspense resolve',
}


def run(kind, repetition):
    name = f'{kind}-{repetition}'
    directory = DESTINATION / name
    directory.mkdir(parents=True, exist_ok=False)
    container = 'blame-vue-suspense-' + name
    command = 'PYTHONPATH=/tests/vendor python3 /tests/grade.py'
    if kind == 'captured':
        command = 'git apply --check /captured.patch && git apply /captured.patch && ' + command
    arguments = ['docker', 'run', '--rm', '--cpus=4', '--memory=8g', '--name', container,
                 '-v', f'{ROOT / "tasks" / TASK / "tests"}:/tests:ro',
                 '-v', f'{directory}:/logs/verifier', '-v', f'{PATCH}:/captured.patch:ro',
                 IMAGE, 'bash', '-lc', command]
    try:
        with (directory / 'container.log').open('wb') as stream:
            result = subprocess.run(arguments, stdout=stream, stderr=subprocess.STDOUT, timeout=1850)
        evaluation = json.loads((directory / 'evaluation.json').read_text())
        return summary(name, result.returncode, evaluation)
    finally:
        subprocess.run(['docker', 'rm', '--force', container], capture_output=True)


def summary(name, exit_code, evaluation):
    return {'case': name, 'containerExitCode': exit_code,
            'reward': evaluation['reward'], 'fullSuitePassed': evaluation['fullSuitePassed'],
            'failToPassPassed': evaluation['failToPassPassed'],
            'failToPassTotal': evaluation['failToPassTotal'],
            'passToPassPassed': evaluation['passToPassPassed'],
            'passToPassTotal': evaluation['passToPassTotal'],
            'failedRequired': evaluation['failedRequired'],
            'originalSuspenseFailures': sorted(FAILURES.intersection(evaluation['failedRequired']))}


def main():
    progress = [json.loads(line) for line in (ROOT / 'progress.jsonl').read_text().split('\n') if line]
    assert progress[-1]['kind'] == 'campaign_complete'
    active = subprocess.run(['docker', 'ps', '-q'], capture_output=True, check=True)
    assert not active.stdout.strip()
    plan = json.loads((ROOT / 'vue-suspense-replay-plan.json').read_text())
    assert hashlib.sha256(PATCH.read_bytes()).hexdigest() == plan['patchSha256']
    cases = []
    for kind, repetition in plan['order']:
        cases.append(run(kind, repetition))
        print(json.dumps(cases[-1]), flush=True)
    result = {'modelCalls': 0, 'cases': cases, 'patchSha256': plan['patchSha256'],
              'note': 'Same frozen image, unchanged official verifier and captured Cline patch. No reference source fix. Sequential isolated controls after all agent trials. Original campaign reward is preserved.'}
    (DESTINATION / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
