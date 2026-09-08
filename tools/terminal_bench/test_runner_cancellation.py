import asyncio
import os
import shutil
import signal
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from harbor.models.agent.context import AgentContext
from tools.terminal_bench.blame_agent import NODE_EXECUTABLE, BlameAgent, stop_runner_command


class DetachedEnvironment:
    def __init__(self, root, deferred=False):
        self.root = root
        self.deferred = deferred
        self.model_requested = asyncio.Event()
        self.start_gate = asyncio.Event()
        self.cleanup_requested = asyncio.Event()
        self.cleanup_gate = asyncio.Event()
        self.cleanup_gate.set()
        self.jobs = []
        self.processes = []
        self.stop_calls = 0

    async def upload_file(self, source, destination):
        shutil.copyfile(source, destination)

    async def exec(self, command, **kwargs):
        job = asyncio.create_task(self.execute(command))
        self.jobs.append(job)
        return await asyncio.shield(job)

    async def execute(self, command):
        command = command.replace(NODE_EXECUTABLE, "node")
        if "blame-headless run" in command:
            self.model_requested.set()
            if self.deferred:
                await self.start_gate.wait()
        if command.startswith("node -e"):
            self.cleanup_requested.set()
            await self.cleanup_gate.wait()
        process = await asyncio.create_subprocess_exec(
            "bash", "-c", command, cwd=self.root, start_new_session=True,
            env={**os.environ, "PATH": f"{self.root / 'bin'}:{os.environ['PATH']}"},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        self.processes.append(process)
        stdout, stderr = await process.communicate()
        return SimpleNamespace(return_code=process.returncode, stdout=stdout.decode(), stderr=stderr.decode())

    async def stop(self, delete):
        self.stop_calls += 1
        await self.close()

    async def close(self):
        self.start_gate.set()
        self.cleanup_gate.set()
        for process in self.processes:
            if process.returncode is None:
                os.killpg(process.pid, signal.SIGKILL)
        await asyncio.gather(*self.jobs, return_exceptions=True)


@unittest.skipUnless(sys.platform == "linux", "The installed runner executes inside Linux task environments")
class RunnerCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="blame-owned-runner-")
        self.root = Path(self.directory.name)
        for name in ["local", "remote", "bin"]:
            (self.root / name).mkdir()
        executable = self.root / "bin/blame-headless"
        executable.write_text('#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync("started", String(process.pid));\nsetInterval(() => fs.appendFileSync("heartbeat", "x"), 10);\n')
        executable.chmod(0o755)
        self.environment = DetachedEnvironment(self.root)
        self.agent = BlameAgent(logs_dir=self.root / "local", environment_logs_dir=self.root / "remote")
        self.agent.session_id = self.root.name
        self.agent._runtime_environment = lambda: {}
        self.run = None

    async def asyncTearDown(self):
        if self.run and not self.run.done():
            self.run.cancel()
        await self.environment.close()
        if self.run:
            await asyncio.gather(self.run, return_exceptions=True)
        self.directory.cleanup()

    def start(self):
        self.run = asyncio.create_task(self.agent.run("Do the task", self.environment, AgentContext()))
        return self.run

    async def wait_for_heartbeat(self):
        for _ in range(300):
            if (self.root / "heartbeat").exists():
                return
            await asyncio.sleep(0.01)
        self.fail("The test runner did not start")

    async def test_forced_cleanup_stops_only_the_owned_trial_environment(self):
        async def fail_cleanup(command, **kwargs):
            return SimpleNamespace(return_code=2)
        self.environment.exec = fail_cleanup
        self.assertFalse(await self.agent._stop_runner(self.environment))
        self.assertEqual(self.environment.stop_calls, 1)

    async def test_changed_process_identity_is_not_signalled(self):
        control = self.root / "remote/runner"
        control.with_suffix(".pid").write_text(str(os.getpid()))
        result = await self.environment.exec(stop_runner_command(control, "different-owned-runner"))
        self.assertEqual(result.return_code, 2)
        self.assertTrue(control.with_suffix(".stop").exists())

    async def test_success_does_not_run_cancellation_cleanup(self):
        (self.root / "bin/blame-headless").write_text("#!/usr/bin/env node\nprocess.exit(0);\n")
        await asyncio.wait_for(self.start(), 2)
        self.assertFalse(self.environment.cleanup_requested.is_set())
        self.assertEqual(self.environment.stop_calls, 0)
        self.assertFalse(hasattr(self.agent, "_cleanup_verified"))

    async def test_cancel_stops_the_runner_before_returning_to_verification(self):
        self.start()
        await self.wait_for_heartbeat()
        self.run.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(self.run, 5)
        before = (self.root / "heartbeat").read_bytes()
        await asyncio.sleep(0.08)
        self.assertEqual((self.root / "heartbeat").read_bytes(), before)
        self.assertTrue(self.agent._cleanup_verified)
        self.assertEqual(self.environment.stop_calls, 0)
        context = AgentContext()
        self.agent.populate_context_post_run(context)
        self.assertTrue(context.metadata["blame_cleanup_verified"])
        self.assertIsNone(context.n_input_tokens)

    async def test_cancel_before_docker_launch_prevents_a_late_model_start(self):
        self.environment.deferred = True
        self.start()
        await asyncio.wait_for(self.environment.model_requested.wait(), 2)
        self.run.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(self.run, 5)
        self.environment.start_gate.set()
        await asyncio.wait_for(asyncio.gather(*self.environment.jobs, return_exceptions=True), 2)
        self.assertFalse((self.root / "started").exists())
        self.assertTrue(self.agent._cleanup_verified)

    async def test_a_second_cancellation_does_not_interrupt_runner_cleanup(self):
        self.environment.cleanup_gate.clear()
        self.start()
        await self.wait_for_heartbeat()
        self.run.cancel()
        await asyncio.wait_for(self.environment.cleanup_requested.wait(), 2)
        self.run.cancel()
        self.environment.cleanup_gate.set()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(self.run, 5)
        self.assertTrue(self.agent._cleanup_verified)
        before = (self.root / "heartbeat").read_bytes()
        await asyncio.sleep(0.08)
        self.assertEqual((self.root / "heartbeat").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
