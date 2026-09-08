import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree


def execute(arguments, directory):
    return subprocess.run(arguments, cwd=directory, check=True, capture_output=True)


def restore_test_paths(specification, directory):
    baseline = specification['baselineCommit']
    for name in specification['testPaths']:
        path = directory / name
        tracked = execute(['git', 'ls-tree', baseline, '--', name], directory).stdout
        if tracked:
            execute(['git', 'restore', '--source', baseline, '--worktree', '--', name], directory)
        elif path.is_file() or path.is_symlink():
            path.unlink()


def run_tests(specification, output):
    with output.open('wb') as stream:
        process = subprocess.Popen(['bash', '-lc', specification['command']],
                                   cwd=specification['workspace'], stdout=stream,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            return process.wait(timeout=specification['testTimeoutSeconds'])
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            return 124


def load_parser(directory):
    specification = importlib.util.spec_from_file_location('external_parser', directory / 'parser.py')
    module = importlib.util.module_from_spec(specification)
    sys.modules[specification.name] = module
    specification.loader.exec_module(module)
    return module


def parse_tests(specification, directory, log):
    if specification['parser'] == 'multi':
        result = load_parser(directory).parse_log(None, log)
        return result.passed_tests, result.failed_tests, result.skipped_tests
    outcomes = [outcome for xml in re.findall(r'<TestRun.*?</TestRun>', log, re.DOTALL)
                for outcome in trx_outcomes(ElementTree.fromstring(xml))]
    passed = {name for name, status in outcomes if status == 'Passed'}
    failed = {name for name, status in outcomes if status in ['Failed', 'Error']}
    skipped = {name for name, status in outcomes if status not in ['Passed', 'Failed', 'Error']}
    return passed - failed - skipped, failed, skipped


def trx_outcomes(root):
    namespace = {'trx': 'http://microsoft.com/schemas/VisualStudio/TeamTest/2010'}
    definitions = {}
    for test in root.findall('.//trx:UnitTest', namespace):
        method = test.find('trx:TestMethod', namespace)
        if method is not None:
            definitions[test.get('id')] = method.get('className') + '.' + method.get('name')
    return [(definitions[result.get('testId')], result.get('outcome'))
            for result in root.findall('.//trx:UnitTestResult', namespace)
            if result.get('testId') in definitions]


def score(specification, passed, failed, skipped, exit_code):
    fail_to_pass = set(specification['failToPass'])
    pass_to_pass = set(specification['passToPass'])
    required = fail_to_pass | pass_to_pass
    completed = exit_code >= 0 and exit_code != 124
    resolved = completed and bool(fail_to_pass) and required <= passed and not required & (failed | skipped)
    return {'reward': int(resolved), 'suiteExitCode': exit_code,
            'fullSuitePassed': resolved and exit_code == 0 and not failed,
            'passed': len(passed), 'failed': len(failed), 'skipped': len(skipped),
            'failToPassTotal': len(fail_to_pass), 'failToPassPassed': len(fail_to_pass & passed),
            'passToPassTotal': len(pass_to_pass), 'passToPassPassed': len(pass_to_pass & passed),
            'missingRequired': sorted(required - passed - failed - skipped),
            'failedRequired': sorted(required & failed), 'skippedRequired': sorted(required & skipped)}


def evaluate(directory, specification, logs):
    workspace = Path(specification['workspace'])
    (logs / 'agent.diff').write_bytes(execute(['git', 'diff', '--binary', specification['baselineCommit']], workspace).stdout)
    (logs / 'agent-status.txt').write_bytes(execute(['git', 'status', '--porcelain=v1', '--untracked-files=all'], workspace).stdout)
    restore_test_paths(specification, workspace)
    patch = str(directory / 'test.patch')
    execute(['git', 'apply', '--check', patch], workspace)
    execute(['git', 'apply', patch], workspace)
    exit_code = run_tests(specification, logs / 'suite.log')
    parsed = parse_tests(specification, directory, (logs / 'suite.log').read_text(errors='replace'))
    return score(specification, *parsed, exit_code)


def main():
    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
    logs = Path(os.environ.get('EXTERNAL_VERIFIER_LOGS', '/logs/verifier'))
    logs.mkdir(parents=True, exist_ok=True)
    specification = json.loads((directory / 'expected.json').read_text())
    try:
        result = evaluate(directory, specification, logs)
    except Exception as error:
        result = {'reward': 0, 'verifierError': type(error).__name__}
        (logs / 'verifier-error.txt').write_text(str(error))
    (logs / 'evaluation.json').write_text(json.dumps(result, indent=2) + '\n')
    (logs / 'reward.txt').write_text(str(result['reward']) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
