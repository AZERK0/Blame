import hashlib
import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TERMINAL = ROOT.parent / 'terminal-bench-frontier-v10b-20260908'
TASKS = json.loads((ROOT / 'prepared-tasks.json').read_text())


def log(kind, **fields):
    record = {'at': datetime.now(timezone.utc).isoformat(), 'kind': kind, **fields}
    print(json.dumps(record), flush=True)
    with (ROOT / 'preflight-progress.jsonl').open('a') as stream:
        stream.write(json.dumps(record) + '\n')


def docker(*arguments, timeout=60):
    return subprocess.run(['docker', *arguments], capture_output=True, timeout=timeout)


def require_isolation():
    events = [json.loads(line) for line in (TERMINAL / 'progress.jsonl').read_text().split('\n') if line]
    assert events[-1]['kind'] == 'campaign_complete', 'Wait until frozen Terminal-Bench campaign completes'
    info = docker('info', '--format', '{{.DockerRootDir}}').stdout.decode().strip()
    assert '/blame-benchmark-docker-20260907/' in info
    assert not docker('ps', '-q').stdout.strip(), 'Dedicated engine has active containers'


def download_node():
    target = ROOT / 'node.tar.xz'
    if not target.exists():
        subprocess.run(['curl', '-fsSL', '--retry', '3', '--max-time', '180',
                        'https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz',
                        '-o', str(target)], check=True)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307'
    for task in TASKS:
        shutil.copy2(target, ROOT / 'contexts' / task['id'] / 'node.tar.xz')


def build(task):
    destination = ROOT / 'preflight' / task['id']
    destination.mkdir(parents=True, exist_ok=True)
    with (destination / 'build.log').open('wb') as stream:
        result = subprocess.run(['docker', 'build', '-t', task['image'],
                                 str(ROOT / 'contexts' / task['id'])],
                                stdout=stream, stderr=subprocess.STDOUT, timeout=1800)
    if result.returncode:
        log('build_failed', task=task['id'], exitCode=result.returncode)
        return False
    inspection = docker('image', 'inspect', task['image'])
    image = json.loads(inspection.stdout)[0]
    proof = image_proof(task)
    baseline = proof['baselineCommit']
    path = ROOT / 'tasks' / task['id'] / 'tests/expected.json'
    specification = json.loads(path.read_text())
    specification['baselineCommit'] = baseline
    path.write_text(json.dumps(specification, indent=2) + '\n')
    (destination / 'image.json').write_text(json.dumps({'imageId': image['Id'], **proof}, indent=2) + '\n')
    log('build_passed', task=task['id'], imageId=image['Id'], baselineCommit=baseline)
    return True


def image_proof(task):
    command = ('test ! -e /home/fix.patch && test ! -e /home/test.patch && '
               'test ! -e /home/fix-run.sh && test ! -e /home/test-run.sh && '
               'git rev-parse HEAD && git rev-list --all --count && '
               'node --version && /opt/blame-node/bin/node --version')
    proof = docker('run', '--rm', '--cpus=1', '--memory=256m', task['image'], 'bash', '-lc', command)
    assert proof.returncode == 0
    baseline, commits, project_node, runtime_node = proof.stdout.decode().strip().split('\n')
    assert commits == '1'
    return {'baselineCommit': baseline, 'gitCommitCount': 1, 'knownOracleFilesAbsent': True,
            'projectNode': project_node, 'runtimeNode': runtime_node}


def control(task, reference):
    name = 'reference' if reference else 'baseline'
    destination = ROOT / 'preflight' / task['id'] / name
    destination.mkdir(parents=True, exist_ok=True)
    arguments = ['run', '--rm', '--cpus=4', '--memory=8g', '--name', f'blame-external-{task["id"].replace("__", "-")}-{name}',
                 '-v', f'{ROOT / "tasks" / task["id"] / "tests"}:/tests:ro',
                 '-v', f'{destination}:/logs/verifier']
    command = 'PYTHONPATH=/tests/vendor python3 /tests/grade.py'
    if reference:
        arguments += ['-v', f'{ROOT / "private-verifiers" / task["id"] / "fix.patch"}:/reference.patch:ro']
        command = 'git apply --check /reference.patch && git apply /reference.patch && ' + command
    result = run_control(arguments, task, command, destination)
    path = destination / 'evaluation.json'
    evaluation = json.loads(path.read_text()) if path.exists() else {'reward': None, 'verifierError': 'MissingEvaluation'}
    log('control_complete', task=task['id'], control=name, containerExitCode=result.returncode,
        evaluation={key: value for key, value in evaluation.items() if not isinstance(value, list)},
        missingRequiredCount=len(evaluation.get('missingRequired', [])),
        failedRequiredCount=len(evaluation.get('failedRequired', [])))
    return evaluation


def run_control(arguments, task, command, destination):
    name = arguments[arguments.index('--name') + 1]
    try:
        with (destination / 'container.log').open('wb') as stream:
            return subprocess.run(['docker', *arguments, task['image'], 'bash', '-lc', command],
                                  stdout=stream, stderr=subprocess.STDOUT, timeout=1850)
    finally:
        docker('rm', '--force', name)


def prepare(task):
    try:
        if build(task):
            control(task, False)
            control(task, True)
    except Exception as error:
        log('preflight_failed', task=task['id'], errorType=type(error).__name__)


def main():
    require_isolation()
    assert not (ROOT / 'preflight-progress.jsonl').exists(), 'Do not overwrite recorded preflight'
    download_node()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(prepare, TASKS))
    log('preflight_complete', tasks=len(TASKS))


if __name__ == '__main__':
    main()
