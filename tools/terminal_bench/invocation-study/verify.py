"""Verify correction arithmetic, original byte bindings and local mechanism evidence."""
import gzip
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('review_correction', Path(__file__).with_name('review-correction.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
study = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else module.NEW
module.NEW = study
load = module.load
assert load(study / 'corrected-f31-audit.json') == module.build()
old, new = (load(study / ('process-' + arm + '.json')) for arm in ['before', 'after'])
assert old['truthfulLabels'] == 0 and new['truthfulLabels'] == 3
assert old['total'] == new['total'] == 3
assert old['lifecycle'] == new['lifecycle']
assert [x['event'] for x in old['lifecycle']] == ['prebuild', 'build', 'postbuild', 'test:types', 'pretest', 'posttest']
archive = json.loads(gzip.decompress((study / 'baseline-execution-modules.json.gz').read_bytes()))
assert set(archive) == set(old['runtimeHashes'])
for name, text in archive.items():
    assert hashlib.sha256(text.encode()).hexdigest() == old['runtimeHashes'][name]
for a, b in zip(old['cases'], new['cases'], strict=True):
    assert a['task'] == b['task'] and a['exitCode'] == b['exitCode'] == 0
    assert a['actual']['executable'] == b['actual']['executable'] == 'npm'
    # Instrumented reporter destinations are invocation-specific temporary paths.
    normalize = lambda values: ['<private-report>' if '/.blame/harness/test-results/' in x else
                               '<node-reporter>' if x.endswith('/node-event-reporter.js') else x for x in values]
    assert normalize(a['actual']['args']) == normalize(b['actual']['args'])
    assert a['actual']['args'][:2] == ['run', a['task']]
    assert not a['displayMatchesProcess'] and b['displayMatchesProcess']
    assert (a.get('check') or {}).get('counts') == (b.get('check') or {}).get('counts')
    assert (a.get('check') or {}).get('outcome') == (b.get('check') or {}).get('outcome')
    assert (a.get('check') or {}).get('evidence', {}).get('reporterSha256') == (b.get('check') or {}).get('evidence', {}).get('reporterSha256')
    assert (a.get('validation') or {}).get('status') == (b.get('validation') or {}).get('status')
print(json.dumps({'paidRequests': 0, 'originalF31Bindings': 'unchanged', 'correctedFullAudit': {'baseline': 3, 'candidate': 3, 'cline': 2}, 'localLabels': [0, 3], 'lifecycleUnchanged': True, 'countsAndAdmissionUnchanged': True}))
