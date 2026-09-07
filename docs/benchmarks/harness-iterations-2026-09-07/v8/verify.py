import hashlib
import json
from pathlib import Path

from collect import MANIFEST, ROOT, read, rows


def input_files():
    workspace = ROOT.parents[2]
    expected = {ROOT / 'protocol.md': MANIFEST['protocolSha256'],
                workspace / 'tools/terminal_bench/blame_agent.py': MANIFEST['adapterSha256']}
    expected.update({ROOT / (name + '.json'): sha for name, sha in MANIFEST['configHashes'].items()})
    expected.update({Path(bundle['path']): bundle['sha256'] for bundle in MANIFEST['bundles'].values()})
    for task in MANIFEST['tasks']:
        expected.update({ROOT.parent / 'upstream/terminal-bench-2' / task['id'] / name: sha
                         for name, sha in task['hashes'].items()})
    return expected


def check_inputs():
    expected = input_files()
    mismatches = [str(path) for path, sha in expected.items()
                  if hashlib.sha256(path.read_bytes()).hexdigest() != sha]
    assert not mismatches, mismatches
    return len(expected)


def image_checks():
    events = [json.loads(line) for line in (ROOT / 'progress.jsonl').read_text().split('\n') if line]
    expected = {task['id']: task['image']['digest'] for task in MANIFEST['tasks']}
    checks = [{'task': event['task'], 'group': event['group'],
               'digests': json.loads(event['digests']), 'expectedDigest': expected[event['task']]}
              for event in events if event['kind'] == 'image_removed']
    for check in checks:
        check['matched'] = any(digest.endswith('@' + check['expectedDigest']) for digest in check['digests'])
    assert all(check['matched'] for check in checks), 'Docker image digest changed'
    return checks


def event_checks():
    records = read(ROOT / 'results.json')['rows']
    assert len(records) == 9 and all(record['resultComplete'] for record in records)
    hashes = {}
    for record in records:
        path = Path(record['path']).parent / 'agent/events.jsonl'
        rows(path)
        hashes[record['trial']] = hashlib.sha256(path.read_bytes()).hexdigest()
        assert hashes[record['trial']] == record['eventSha256'], record['trial']
    return records, hashes


def main():
    count = check_inputs()
    records, hashes = event_checks()
    images = image_checks()
    post_verifier = read(ROOT / 'post-verifier-audit.json')
    audit = read(ROOT / 'audit-candidates.json')
    expected = {(group['id'], task) for group in MANIFEST['groups'] for task in group['tasks']}
    observed = {(image['group'], image['task']) for image in images}
    assert len(images) == len(expected) and observed == expected, 'Missing image observation'
    assert post_verifier and len(audit['trials']) == 9, 'Incomplete audit artifacts'
    result = {'inputFilesVerified': count, 'allInputsUnchanged': True,
              'trials': len(records), 'eventHashes': hashes, 'imageChecks': images,
              'auditToolStarts': sum(trial['started'] for trial in audit['trials']),
              'missingUsageTrials': [record['trial'] for record in records if not record['usageComplete']],
              'postVerifierAuditPresent': bool(post_verifier),
              'note': 'Image observations occur after both arms finish each task in each repetition. Absence of a candidate match does not prove absence of contamination; see manual adjudication. Recorder times are not server-side execution clocks.'}
    (ROOT / 'integrity.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'verifiedInputs': count, 'trials': len(records), 'imageObservations': len(images)}))


if __name__ == '__main__':
    main()
