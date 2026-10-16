"""Reject inconsistent favorable regrading and corrupted local evidence."""
import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
study = repo / 'docs/experiments/light-harness-invocation-f33-2026-10-16'
verifier = Path(__file__).with_name('verify.py')
def replay(path):
    return subprocess.run([sys.executable, str(verifier), str(path)], capture_output=True, text=True)
assert replay(study).returncode == 0
faults = []
with tempfile.TemporaryDirectory(prefix='blame-invocation-faults-') as directory:
    target = Path(directory)
    for p in study.iterdir(): (target / p.name).symlink_to(p)
    cases = [
        ('corrected-f31-audit.json', 'fabricated full acceptance', lambda v: v['rows'][5].update(auditedSuccess=True)),
        ('corrected-f31-audit.json', 'changed historical token subtotal', lambda v: v['arms']['baseline'].update(tokens=0)),
        ('corrected-f31-audit.json', 'erased behavioral regression', lambda v: v.update(qualityGate=True)),
        ('corrected-f31-audit.json', 'fabricated paired efficiency', lambda v: v['comparisons'][0]['resources']['cost'].update(relativeChange=-.9)),
        ('process-before.json', 'removed lifecycle hook', lambda v: v['lifecycle'].pop()),
        ('process-after.json', 'changed actual executable', lambda v: v['cases'][0]['actual'].update(executable='node')),
        ('process-after.json', 'promoted admission', lambda v: v['cases'][2]['validation'].update(status='passed')),
    ]
    for filename, label, mutate in cases:
        value = json.loads((study / filename).read_text())
        mutate(value)
        path = target / filename
        path.unlink(); path.write_text(json.dumps(value))
        assert replay(target).returncode != 0, label
        faults.append({'fault': label, 'rejected': True})
        path.unlink(); path.symlink_to(study / filename)
print(json.dumps({'paidRequests': 0, 'negativeControls': faults}, indent=2))
