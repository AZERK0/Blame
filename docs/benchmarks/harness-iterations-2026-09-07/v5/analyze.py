import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
METRICS = ['tokens', 'cost', 'agentSeconds', 'requests', 'tools']


def total(rows, field):
    values = [row.get(field) for row in rows]
    return sum(values) if values and all(isinstance(value, (int, float)) for value in values) else None


def comparison(rows, other):
    tasks = {r['task'] for r in rows}
    paired = {task: {r['arm']: r for r in rows if r['task'] == task} for task in tasks}
    eligible = [task for task, arms in paired.items() if all(arms[arm]['auditedReward'] == 1 and arms[arm]['usageComplete'] for arm in ['final', other])]
    result = {'selectedJointSuccessCompleteTasks': sorted(eligible), 'metrics': {}}
    for metric in METRICS:
        left = total([paired[t]['final'] for t in eligible], metric)
        right = total([paired[t][other] for t in eligible], metric)
        result['metrics'][metric] = {'final': left, other: right, 'ratio': left / right if left is not None and right else None}
    return result


value = json.loads((ROOT / 'results.json').read_text())
rows = value['rows']
expected = {(t, a) for t in ['sparql-university', 'build-cython-ext', 'regex-chess'] for a in ['before', 'final', 'cline']}
assert len(rows) == 9 and {(r['task'], r['arm']) for r in rows} == expected
fields = ['task', 'arm', 'reward', 'auditedReward', 'usageComplete', 'agentSeconds', 'tokens', 'cost', 'requests', 'tools', 'edits', 'blockedEdits']
report = {'note': 'Known-task diagnostic, one trial per task and arm. All attempts retained. Missing usage is unknown; observed partial sums are lower bounds. Joint-success complete-usage comparisons are selected subsets, not global claims.',
          'summary': value['summary'], 'rows': [{k: r[k] for k in fields} | {'exceptionType': (r.get('exception') or {}).get('exception_type')} for r in rows],
          'jointSuccessComplete': {arm: comparison(rows, arm) for arm in ['before', 'cline']}}
(ROOT / 'analysis.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report['jointSuccessComplete']))
