import hashlib
import json
import shutil
from pathlib import Path

from unidiff import PatchSet

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]
DOTNET_IMAGE = 'mcr.microsoft.com/dotnet/sdk@sha256:bbcc25ec18dfc904271748a3c3d36edc989458ff3948e7cd300504754d9a4c2d'
COMMANDS = {
    'mui__material-ui-23778': ('/home/material-ui', 'yarn run test:unit --reporter json --exit'),
    'vuejs__core-11491': ('/home/core', 'pnpm run test-unit --no-watch --reporter=verbose'),
    'fasterxml__jackson-databind-4468': ('/home/jackson-databind', 'mvn clean test -Dmaven.test.skip=false -DfailIfNoTests=false'),
    'googlecontainertools__jib-4035': ('/home/jib', './gradlew clean test --continue'),
    'serilog__serilog-2103': ('/workspace', 'test/Serilog.Tests/Serilog.Tests.csproj'),
    'avaloniaui__avalonia-15640': ('/workspace', 'tests/Avalonia.Controls.UnitTests/Avalonia.Controls.UnitTests.csproj'),
}


def encoded(value):
    return json.dumps(value, indent=2) + '\n'


def csharp_command(project):
    return ('rm -rf /tmp/external-test-results; mkdir /tmp/external-test-results; '
            f'dotnet test {project} --framework net8.0 --logger "trx;LogFileName=tests.trx" '
            '--results-directory /tmp/external-test-results; test_status=$?; '
            'cat /tmp/external-test-results/*.trx; exit "$test_status"')


def dockerfile(image, workspace, source):
    copy = 'COPY source/ /workspace/\n' if source else ''
    return (f'FROM {image}\nUSER root\n'
            'RUN apt-get update && apt-get install -y --no-install-recommends python3 git curl ca-certificates xz-utils libfontconfig1 && rm -rf /var/lib/apt/lists/*\n'
            'COPY node.tar.xz /tmp/blame-external-node.tar.xz\n'
            'RUN echo "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  /tmp/blame-external-node.tar.xz" | sha256sum -c - && mkdir -p /opt/blame-node && tar -xJf /tmp/blame-external-node.tar.xz -C /opt/blame-node --strip-components=1 && if ! command -v node >/dev/null; then ln -sf /opt/blame-node/bin/node /usr/local/bin/node; fi && if ! command -v npm >/dev/null; then ln -sf /opt/blame-node/bin/npm /usr/local/bin/npm; fi && rm /tmp/blame-external-node.tar.xz\n'
            f'{copy}WORKDIR {workspace}\n'
            'RUN rm -f /home/*.patch /home/*.log /home/run.sh /home/test-run.sh /home/fix-run.sh /home/prepare.sh /home/check_git_changes.sh /root/.bash_history && rm -rf .git && git init -q && git config user.email benchmark@localhost && git config user.name Benchmark && git add . && GIT_AUTHOR_DATE=2000-01-01T00:00:00Z GIT_COMMITTER_DATE=2000-01-01T00:00:00Z git commit -qm baseline && git update-ref refs/blame-benchmark/base HEAD\n'
            'ENV DOTNET_CLI_TELEMETRY_OPTOUT=1\nENV DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1\n')


def prepare_tests(name, data, workspace, command):
    source = ROOT / 'private-verifiers' / name
    tests = ROOT / 'tasks' / name / 'tests'
    tests.mkdir(parents=True, exist_ok=True)
    csharp = 'FAIL_TO_PASS' in data
    for filename in ['test.patch'] if csharp else ['parser.py', 'test.patch']:
        shutil.copy2(source / filename, tests / filename)
    shutil.copy2(WORKSPACE / 'tools/terminal_bench/external/grade.py', tests / 'grade.py')
    specification = {'workspace': workspace, 'command': csharp_command(command) if csharp else command,
                     'parser': 'csharp' if csharp else 'multi', 'testTimeoutSeconds': 1700,
                     'testPaths': sorted({patch.path for patch in PatchSet(data['test_patch'])}),
                     'failToPass': list(data.get('FAIL_TO_PASS', data.get('f2p_tests', {}))),
                     'passToPass': list(data.get('PASS_TO_PASS', data.get('p2p_tests', {}))),
                     'baselineCommit': 'TO_BE_RECORDED_AFTER_IMAGE_BUILD'}
    (tests / 'expected.json').write_text(encoded(specification))
    (tests / 'test.sh').write_text('#!/bin/bash\nset -eu\nPYTHONPATH=/tests/vendor python3 /tests/grade.py\n')
    return specification


def task_instruction(data):
    if 'problem_statement' in data:
        return data['problem_statement'].strip() + '\n'
    return '\n\n'.join(issue['title'] + '\n\n' + (issue['body'] or '')
                       for issue in data['resolved_issues']) + '\n'


def prepare_task(name, image):
    data = json.loads((ROOT / 'private-verifiers' / name / 'instance.json').read_text())
    workspace, command = COMMANDS[name]
    context = ROOT / 'contexts' / name
    context.mkdir(parents=True, exist_ok=True)
    csharp = 'FAIL_TO_PASS' in data
    if csharp:
        source = next((ROOT / 'source-workspaces' / name).iterdir())
        shutil.copytree(source, context / 'source', dirs_exist_ok=True)
    (context / 'Dockerfile').write_text(dockerfile(image, workspace, csharp))
    specification = prepare_tests(name, data, workspace, command)
    task = ROOT / 'tasks' / name
    (task / 'instruction.md').write_text(task_instruction(data))
    tag = f'blame-external-20260908:{name.replace("__", "-")}'
    return {'id': name, 'image': tag, 'baseImage': image, 'workspace': workspace,
            'officialFailToPass': len(specification['failToPass']), 'officialPassToPass': len(specification['passToPass']),
            'instructionSha256': hashlib.sha256((task / 'instruction.md').read_bytes()).hexdigest(),
            'sourceBaseCommit': data.get('base_commit', data.get('base', {}).get('sha')),
            'parserSha256': hashlib.sha256((ROOT / 'private-verifiers' / name / 'parser.py').read_bytes()).hexdigest()}


def main():
    assert not (ROOT / 'preflight-progress.jsonl').exists(), 'Do not replace prepared tasks after controls start'
    images = {item['instance']: item['reference'].split(':')[0] + '@' + item['digest']
              for item in json.loads((ROOT / 'multi-image-preflight.json').read_text())}
    records = [prepare_task(name, images.get(name, DOTNET_IMAGE)) for name in COMMANDS]
    (ROOT / 'prepared-tasks.json').write_text(encoded(records))
    print(encoded(records))


if __name__ == '__main__':
    main()
