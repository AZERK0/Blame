import csv
import hashlib
import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

from timing import durations

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / 'manifest.json').read_text())
FIELDS = {'input': 'inputTokens', 'output': 'outputTokens', 'cache': 'cacheReadTokens', 'cost': 'cost'}
TOTALS = {'input': 'totalInputTokens', 'output': 'totalOutputTokens', 'cache': 'totalCacheReadTokens', 'cost': 'totalCost'}


def read(path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def rows(path):
    if not path.exists():
        return []
    return [dict(json.loads(line), line=index + 1)
            for index, line in enumerate(path.read_text().split('\n')) if line]


def elapsed(stage):
    if not stage or not stage.get('started_at') or not stage.get('finished_at'):
        return None
    return (datetime.fromisoformat(stage['finished_at']) - datetime.fromisoformat(stage['started_at'])).total_seconds()


def observed_total(values):
    if not values or any(not isinstance(value, (int, float)) for value in values):
        return None
    return sum(values)


def usage_metrics(events, agent):
    usages = [row['event']['payload'].get('usage', {}) for row in events if row['event']['type'] == 'usage']
    contexts = sum(row['event'].get('payload', {}).get('kind') == 'context_composed' for row in events)
    iterations = sum(row['event'].get('payload', {}).get('message') == 'Agent iteration started.' for row in events)
    requests = max(contexts, iterations)
    values = {key: observed_total([usage.get(name) for usage in usages]) for key, name in FIELDS.items()}
    aggregate = (agent.get('usage') or {}).get('aggregateUsage') or {}
    cache_omissions = sum('cacheReadTokens' not in usage for usage in usages)
    if values['cache'] is None and aggregate.get('totalCacheReadTokens') is not None:
        values['cache'] = aggregate['totalCacheReadTokens']
    reconciled = bool(aggregate) and all(values[key] is not None and aggregate.get(TOTALS[key]) is not None and
                 math.isclose(values[key], aggregate[TOTALS[key]], rel_tol=1e-9, abs_tol=1e-9) for key in ['input', 'output', 'cost'])
    values['tokens'] = values['input'] + values['output'] if values['input'] is not None and values['output'] is not None else None
    values['uncachedInput'] = values['input'] - values['cache'] if values['input'] is not None and values['cache'] is not None else None
    return dict(values, requests=requests, usageRecords=len(usages), aggregateReconciled=reconciled, cacheRequestOmissions=cache_omissions, contextRecords=contexts, iterationStarts=iterations,
                usageComplete=requests == len(usages) and requests > 0 and reconciled)


def tools_metrics(events):
    calls = [row['event']['payload'] for row in events if row['event']['type'] == 'tool']
    finished = [call for call in calls if call.get('phase') == 'finished']
    edits = [call for call in finished if call.get('toolCall', {}).get('name') == 'edit_code']
    blocked = [call for call in finished if isinstance(call.get('output'), dict) and call['output'].get('status') == 'blocked']
    return {'tools': sum(call.get('phase') == 'started' for call in calls),
            'toolsFinished': len(finished), 'toolNames': dict(Counter(call.get('toolCall', {}).get('name') for call in finished)),
            'edits': len(edits), 'blockedEdits': sum(call in blocked for call in edits),
            'blockedCategories': dict(Counter(call['output'].get('category') for call in blocked))}


def trial(path):
    result, agent = read(path), read(path.parent / 'agent/result.json')
    config = read(path.parent / 'config.json')
    environment = config['agent']['env']
    arm = 'cline' if environment['BLAME_BENCHMARK_HARNESS'] == 'cline' else Path(environment['BLAME_BENCHMARK_BUNDLE']).stem.removeprefix('runner-')
    task = result.get('task_name', config['task']['path']).rsplit('/', 1)[-1]
    metadata = next(task_row for task_row in MANIFEST['tasks'] if task_row['id'] == task)
    group = next(group for group in MANIFEST['groups'] if group['id'] == path.parents[1].name)
    event_path = path.parent / 'agent/events.jsonl'
    events = rows(event_path)
    reward = ((result.get('verifier_result') or {}).get('rewards') or {}).get('reward')
    record = {'task': task, 'arm': arm, 'repetition': group['repetition'], 'group': group['id'],
              'trial': path.parent.name, 'path': str(path), 'stratum': metadata['stratum'],
              'seenBeforeCampaign': metadata['seenBeforeCampaign'], 'reward': reward,
              'auditedReward': 1 if reward == 1 else 0, 'status': agent.get('status'),
              'completionVerification': (agent.get('completion') or {}).get('verification'),
              'resultComplete': bool(result), 'exception': result.get('exception_info') if result else {'exception_type': 'IncompleteResultArtifact'}, 'errors': [row['event']['payload'] for row in events if row['event']['type'] == 'error'],
              'agentSeconds': elapsed(result.get('agent_execution')), 'runnerMs': agent.get('durationMs'),
              'stages': {key: elapsed(result.get(key)) for key in ['environment_setup', 'agent_setup', 'agent_execution', 'verifier']},
              'eventSha256': hashlib.sha256(event_path.read_bytes()).hexdigest() if event_path.exists() else None,
              'timing': durations(events)}
    return dict(record, **usage_metrics(events, agent), **tools_metrics(events))


def summarize(records):
    fields = ['tokens', 'input', 'output', 'cache', 'uncachedInput', 'cost', 'agentSeconds', 'runnerMs', 'requests', 'tools', 'edits', 'blockedEdits']
    values = {field: observed_total([record.get(field) for record in records]) for field in fields}
    if any(not record['usageComplete'] for record in records):
        values.update({field: None for field in ['tokens', 'input', 'output', 'cache', 'uncachedInput', 'cost']})
    return dict(values, runs=len(records), passed=sum(record['auditedReward'] for record in records),
                nominalPassed=sum(record['reward'] == 1 for record in records),
                incompleteUsage=[record['trial'] for record in records if not record['usageComplete']],
                missingReward=[record['trial'] for record in records if record['reward'] is None],
                missing={field: sum(record.get(field) is None for record in records) for field in fields},
                observedPartialSums={field: sum(record[field] for record in records if record.get(field) is not None) for field in fields})


def apply_adjudication(records):
    decisions = read(ROOT / 'adjudication.json')
    for record in records:
        decision = decisions.get(record['trial'], {})
        record['audit'] = decision
        if decision.get('oracleConfirmed') or decision.get('verifierTamperingConfirmed'):
            record['auditedReward'] = 0


def collect():
    records = [trial(path.with_name('result.json')) for path in sorted((ROOT / 'jobs').glob('*/*/config.json'))]
    apply_adjudication(records)
    summaries = {arm: summarize([record for record in records if record['arm'] == arm]) for arm in sorted({record['arm'] for record in records})}
    result = {'rows': records, 'summary': summaries}
    (ROOT / 'results.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    with (ROOT / 'trials.csv').open('w', newline='') as stream:
        fields = ['task', 'arm', 'repetition', 'group', 'trial', 'reward', 'auditedReward', 'status', 'completionVerification', 'usageComplete', 'tokens', 'input', 'output', 'cache', 'uncachedInput', 'cost', 'agentSeconds', 'runnerMs', 'requests', 'tools', 'edits', 'blockedEdits']
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore', lineterminator='\n')
        writer.writeheader()
        writer.writerows(records)
    print(json.dumps(summaries))


if __name__ == '__main__':
    collect()
