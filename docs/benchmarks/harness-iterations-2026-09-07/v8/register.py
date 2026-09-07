import hashlib
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[2]
OLD = ROOT.parent / 'terminal-bench-global-20260906'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2) + '\n')


def agent(arm):
    bundle = 'final' if arm == 'cline' else arm
    return {'import_path': 'tools.terminal_bench.blame_agent:BlameAgent',
            'model_name': 'openai-codex/gpt-5.6-luna',
            'env': {'BLAME_BENCHMARK_HARNESS': 'cline' if arm == 'cline' else 'blame',
                    'BLAME_MODEL_ID': 'gpt-5.6-luna', 'BLAME_PROVIDER_ID': 'openai-codex',
                    'BLAME_REASONING_EFFORT': 'high', 'BLAME_MAX_ITERATIONS': '64',
                    'BLAME_TIMEOUT_SECONDS': '900', 'BLAME_ISOLATED_ENVIRONMENT': 'true',
                    'BLAME_BENCHMARK_BUNDLE': str(ROOT / f'runner-{bundle}.tgz')}}


def main():
    assert not (ROOT / 'manifest.json').exists()
    previous = json.loads((OLD / 'manifest.json').read_text())
    ids = ['financial-document-processor', 'gcode-to-text']
    confirmation = json.loads((ROOT.parent / 'terminal-bench-frontier-v7-20260907/manifest.json').read_text())
    available = {row['id']: row for row in previous['tasks'] + confirmation['tasks']}
    tasks = [dict(available[name], seenBeforeCampaign=True) for name in ids]
    origins = {'before': ROOT.parent / 'terminal-bench-frontier-v7-20260907/runner-final.tgz',
               'final': ROOT.parent / 'harness-iterations-20260907/runner-v8.tgz'}
    bundles = {}
    for arm, origin in origins.items():
        target = ROOT / f'runner-{arm}.tgz'
        shutil.copy2(origin, target)
        bundles[arm] = {'path': str(target), 'sha256': digest(target)}
    assert bundles['before']['sha256'] == 'ec0528743686690de7be7692891211de12090f9bc2c70216a85bd7bdcbb38a59'
    groups = [
        {'id': 'batch-01', 'repetition': 1, 'tasks': ids, 'armOrder': ['final', 'cline', 'before'], 'trials': 6},
        {'id': 'batch-02', 'repetition': 2, 'tasks': ['financial-document-processor'], 'armOrder': ['before', 'cline', 'final'], 'trials': 3},
    ]
    for group in groups:
        save(group['id'] + '.json', {'job_name': group['id'], 'jobs_dir': str(ROOT / 'jobs'), 'n_attempts': 1,
             'n_concurrent_trials': 2, 'quiet': True, 'retry': {'max_retries': 0},
             'environment': {'type': 'docker', 'delete': True}, 'agents': [agent(arm) for arm in group['armOrder']],
             'tasks': [{'path': str(ROOT.parent / 'upstream/terminal-bench-2' / name)} for name in group['tasks']]})
    save('manifest.json', {'registeredAt': datetime.now(timezone.utc).isoformat(), 'bundles': bundles,
         'groups': groups, 'tasks': tasks, 'protocolSha256': digest(ROOT / 'protocol.md'),
         'adapterSha256': digest(WORKSPACE / 'tools/terminal_bench/blame_agent.py'),
         'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
         'upstreamCommit': previous['upstreamCommit'], 'configHashes': {group['id']: digest(ROOT / (group['id'] + '.json')) for group in groups},
         'initialDockerImages': subprocess.check_output(['docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'], text=True).splitlines()})
    print(json.dumps({'tasks': ids, 'trials': 9, 'bundles': bundles}))


if __name__ == '__main__':
    main()
