import hashlib
import json
import sys
from pathlib import Path

from collect import MANIFEST, ROOT, read, rows


def check_inputs():
    adapter = ROOT / 'frozen-adapter.py' if '--archived-adapter' in sys.argv else ROOT.parents[2] / 'tools/terminal_bench/blame_agent.py'
    expected = {ROOT / 'protocol.md': MANIFEST['protocolSha256'],
                adapter: MANIFEST['adapterSha256'],
                ROOT / 'eligible-tasks.json': MANIFEST['selectionSha256']}
    expected.update({ROOT / (name + '.json'): sha for name, sha in MANIFEST['configHashes'].items()})
    expected.update({Path(bundle['path']): bundle['sha256'] for bundle in MANIFEST['bundles'].values()})
    for task in MANIFEST['tasks']:
        expected.update({Path(task['path']) / name: sha for name, sha in task['hashes'].items()})
    for path, digest in expected.items():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest, path
    return len(expected)


def check_events():
    records = read(ROOT / 'results.json')['rows']
    expected = sum(group['trials'] for group in MANIFEST['groups'])
    assert len(records) == expected and all(record['resultComplete'] for record in records)
    hashes = {}
    for record in records:
        directory = Path(record['path']).parent
        path = directory / 'agent/events.jsonl'
        rows(path)
        hashes[record['trial']] = hashlib.sha256(path.read_bytes()).hexdigest()
        assert hashes[record['trial']] == record['eventSha256']
        evaluation = read(directory / 'verifier/evaluation.json')
        assert evaluation and evaluation['reward'] == record['reward'], record['trial']
    return records, hashes


def main():
    count = check_inputs()
    records, hashes = check_events()
    audit = read(ROOT / 'audit-candidates.json')
    adjudication = read(ROOT / 'adjudication.json')
    post_verifier = read(ROOT / 'post-verifier-audit.json')
    assert len(audit['trials']) == len(records) == len(post_verifier['trials'])
    assert {row['trial'] for row in records} <= set(adjudication)
    result = {'adapterVerification': 'archived' if '--archived-adapter' in sys.argv else 'live workspace',
              'inputFilesVerified': count, 'allInputsUnchanged': True, 'trials': len(records),
              'eventHashes': hashes, 'auditToolStarts': sum(row['started'] for row in audit['trials']),
              'missingUsageTrials': [row['trial'] for row in records if not row['usageComplete']],
              'postVerifierToolStarts': sum(len(row['postVerifierToolCalls']) for row in post_verifier['trials'])}
    (ROOT / 'integrity.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'verifiedInputs': count, 'trials': len(records)}))


if __name__ == '__main__':
    main()
