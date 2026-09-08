import io
import os
import shlex
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

from tools.terminal_bench.blame_agent import BlameAgent, node_install_command


class NodeInstallationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='blame-node-isolation-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.node = Path(shutil.which('node')).resolve()
        for name in ['system', 'stubs', 'tmp', 'private/bin', 'installed']:
            (self.root / name).mkdir(parents=True, exist_ok=True)
        self.write_executable('system/node', 'if [ "$1" = -e ]; then exit 1; fi\nprintf "project-node-20\\n"\n')
        self.write_executable('system/npm', 'printf "project-npm\\n"\n')
        self.write_executable('stubs/curl', 'exit 0\n')
        self.write_executable('stubs/sha256sum', 'cat >/dev/null\nexit 0\n')
        self.write_executable('stubs/tar',
                              f'mkdir -p {shlex.quote(str(self.root / "private/bin"))}\n'
                              f'ln -sf {shlex.quote(str(self.node))} {shlex.quote(str(self.root / "private/bin/node"))}\n')

    def write_executable(self, name, content):
        path = self.root / name
        path.write_text('#!/bin/sh\n' + content)
        path.chmod(0o755)

    def local_command(self, command):
        replacements = {'/opt/blame-node': self.root / 'private', '/usr/local/bin': self.root / 'system',
                        '/installed-agent': self.root / 'installed', '/tmp/': str(self.root / 'tmp') + '/'}
        for original, replacement in sorted(replacements.items(), key=lambda item: len(item[0])):
            command = command.replace(original, str(replacement))
        return command

    def run_shell(self, command, stubs=True):
        paths = [self.root / 'system', *([self.root / 'stubs'] if stubs else [])]
        environment = dict(os.environ, PATH=':'.join(map(str, paths)) + ':' + os.environ['PATH'])
        return subprocess.run(['bash', '-c', self.local_command(command)], env=environment,
                              text=True, capture_output=True, timeout=10)

    def test_installing_runtime_preserves_project_node_and_npm(self):
        before = {name: (self.root / 'system' / name).read_bytes() for name in ['node', 'npm']}
        result = self.run_shell(node_install_command())
        self.assertEqual(result.returncode, 0, result.stderr)
        for name, content in before.items():
            self.assertFalse((self.root / 'system' / name).is_symlink())
            self.assertEqual((self.root / 'system' / name).read_bytes(), content)
        self.assertTrue((self.root / 'private/bin/node').exists())

    def test_runner_uses_private_node_with_legacy_project_node(self):
        (self.root / 'private/bin/node').symlink_to(self.node)
        (self.root / 'system/blame-headless').symlink_to(self.root / 'installed/blame/dist/cli.js')
        content = b'#!/usr/bin/env node\nconsole.log(process.versions.node);\n'
        with tarfile.open(self.root / 'tmp/blame-benchmark-runner.tgz', 'w:gz') as archive:
            member = tarfile.TarInfo('dist/cli.js')
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
        agent = BlameAgent(logs_dir=self.root / 'logs')
        result = self.run_shell(agent._install_runner_command(), stubs=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), subprocess.check_output([self.node, '-p', 'process.versions.node'], text=True).strip())
        self.assertEqual(self.run_shell('node --version').stdout.strip(), 'project-node-20')
        self.assertEqual((self.root / 'installed/blame/dist/cli.js').read_bytes(), content)

    def test_compatible_project_node_can_be_reused_without_replacing_it(self):
        (self.root / 'system/node').unlink()
        (self.root / 'system/node').symlink_to(self.node)
        for _ in range(2):
            result = self.run_shell(node_install_command())
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((self.root / 'private/bin/node').exists())
            self.assertEqual((self.root / 'private/bin/node').resolve(), self.node)
            self.assertEqual((self.root / 'system/node').resolve(), self.node)


if __name__ == '__main__':
    unittest.main()
