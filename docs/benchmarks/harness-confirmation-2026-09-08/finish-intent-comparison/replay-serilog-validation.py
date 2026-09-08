import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DESTINATION = ROOT / 'serilog-validation-replay'
IMAGE = 'blame-external-20260908:serilog-serilog-2103'
NAME = 'blame-serilog-validation-replay'


def docker(*arguments, timeout=300):
    return subprocess.run(['docker', *arguments], capture_output=True, timeout=timeout)


def invoke(label, command):
    result = docker('exec', NAME, 'bash', '-lc', command)
    (DESTINATION / (label + '.log')).write_bytes(result.stdout + result.stderr)
    return {'exitCode': result.returncode, 'stdoutBytes': len(result.stdout),
            'stderrBytes': len(result.stderr),
            'ownRegressionMentioned': b'PropertiesWithPrivateGettersAreIgnored' in result.stdout + result.stderr}


def main():
    events = [json.loads(line) for line in (ROOT / 'progress.jsonl').read_text().split('\n') if line]
    assert events[-1]['kind'] == 'campaign_complete'
    assert not docker('ps', '-q').stdout.strip()
    DESTINATION.mkdir(exist_ok=False)
    patch = next(ROOT.glob('jobs/*/*Cj3M5AF/verifier/agent.diff'))
    started = docker('run', '-d', '--cpus=4', '--memory=8g', '--name', NAME,
                     '-v', f'{patch}:/captured.patch:ro', IMAGE, 'sleep', 'infinity')
    assert started.returncode == 0
    try:
        assert docker('exec', NAME, 'git', 'apply', '/captured.patch').returncode == 0
        command = 'dotnet test test/Serilog.Tests/Serilog.Tests.csproj --framework net8.0 --filter FullyQualifiedName~PropertyValueConverterTests'
        empty = invoke('without-restore', command + ' --no-restore')
        actual = invoke('with-restore', command)
        result = {'withoutRestore': empty, 'withRestore': actual, 'modelCalls': 0,
                  'note': 'Captured agent source and its own regression test; no hidden test patch or reference fix is injected.'}
        (DESTINATION / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    finally:
        docker('rm', '--force', NAME)


if __name__ == '__main__':
    main()
