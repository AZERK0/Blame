import subprocess
import tempfile
import unittest
from pathlib import Path

from tools.terminal_bench.external.grade import evaluate, run_tests, score


class ExternalVerifierTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='blame-external-grader-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.workspace = self.root / 'workspace'
        self.tests = self.root / 'hidden'
        self.logs = self.root / 'logs'
        for directory in [self.workspace, self.tests, self.logs]:
            directory.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@localhost')
        self.git('config', 'user.name', 'Fixture')
        (self.workspace / 'value.py').write_text('value = 1\n')
        (self.workspace / 'check.py').write_text('print("existing")\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'baseline')
        self.baseline = self.git('rev-parse', 'HEAD').stdout.decode().strip()
        (self.workspace / 'check.py').write_text('from value import value\nprint("PASS" if value == 2 else "FAIL")\n')
        (self.tests / 'test.patch').write_bytes(self.git('diff').stdout)
        self.git('restore', 'check.py')
        self.write_parser()

    def git(self, *arguments):
        return subprocess.run(['git', *arguments], cwd=self.workspace, check=True, capture_output=True)

    def write_parser(self):
        (self.tests / 'parser.py').write_text(
            'from types import SimpleNamespace\n'
            'def parse_log(_, log):\n'
            '    passed = {"regression"} if log.strip() == "PASS" else set()\n'
            '    return SimpleNamespace(passed_tests=passed, failed_tests={"regression"} - passed, skipped_tests=set())\n'
        )

    def specification(self):
        return {'baselineCommit': self.baseline, 'workspace': str(self.workspace),
                'testPaths': ['check.py'], 'command': 'python3 check.py', 'testTimeoutSeconds': 5,
                'parser': 'multi', 'failToPass': ['regression'], 'passToPass': []}

    def test_bad_implementation_cannot_pass_by_replacing_existing_test(self):
        (self.workspace / 'check.py').write_text('print("PASS")\n')
        result = evaluate(self.tests, self.specification(), self.logs)
        self.assertEqual(result['reward'], 0)
        self.assertEqual(result['failedRequired'], ['regression'])
        self.assertIn(b'print("PASS")', (self.logs / 'agent.diff').read_bytes())

    def test_correct_implementation_passes_after_hidden_test_injection(self):
        (self.workspace / 'value.py').write_text('value = 2\n')
        result = evaluate(self.tests, self.specification(), self.logs)
        self.assertEqual(result['reward'], 1)
        self.assertTrue(result['fullSuitePassed'])

    def test_missing_skipped_or_conflicting_required_results_never_pass(self):
        specification = self.specification()
        for passed, failed, skipped in [(set(), set(), set()), (set(), set(), {'regression'}),
                                       ({'regression'}, {'regression'}, set())]:
            self.assertEqual(score(specification, passed, failed, skipped, 0)['reward'], 0)

    def test_subset_reward_does_not_hide_full_suite_failure(self):
        result = score(self.specification(), {'regression'}, {'unrelated'}, set(), 1)
        self.assertEqual(result['reward'], 1)
        self.assertFalse(result['fullSuitePassed'])
        self.assertEqual(result['suiteExitCode'], 1)

    def test_empty_fail_to_pass_set_is_not_discriminating(self):
        specification = dict(self.specification(), failToPass=[])
        self.assertEqual(score(specification, {'unrelated'}, set(), set(), 0)['reward'], 0)

    def test_timeout_after_partial_output_is_not_a_pass(self):
        specification = self.specification()
        result = score(specification, {'regression'}, set(), set(), 124)
        self.assertEqual(result['reward'], 0)

    def test_test_process_is_stopped_at_verifier_deadline(self):
        specification = dict(self.specification(), testTimeoutSeconds=0.05,
                             command='python3 -c "import time; time.sleep(10)"')
        self.assertEqual(run_tests(specification, self.logs / 'timeout.log'), 124)


if __name__ == '__main__':
    unittest.main()
