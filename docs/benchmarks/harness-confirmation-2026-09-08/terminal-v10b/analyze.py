import json
import random
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMPARATOR = 'cline'
FIELDS = ['agentSeconds', 'tokens', 'cost', 'requests']


def percentiles(values):
    ordered = sorted(values)
    return [ordered[int((len(ordered) - 1) * point)] for point in [0.025, 0.975]]


def paired_blocks(rows):
    blocks = defaultdict(lambda: defaultdict(list))
    for row in rows:
        blocks[row['task']][row['arm']].append(row)
    return [arms for arms in blocks.values() if all(len(arms[arm]) == 2 for arm in ['final', COMPARATOR])]


def metric_sum(blocks, arm, field):
    values = [row.get(field) for block in blocks for row in block[arm]]
    return sum(values) if values and all(isinstance(value, (int, float)) for value in values) else None


def ratio(blocks, field):
    left, right = (metric_sum(blocks, arm, field) for arm in ['final', COMPARATOR])
    return left / right if left is not None and right is not None and right > 0 else None


def success_difference(blocks):
    return (metric_sum(blocks, 'final', 'auditedReward') - metric_sum(blocks, COMPARATOR, 'auditedReward')) / (2 * len(blocks))


def bootstrap(blocks, measure):
    if not blocks:
        return None
    randomizer = random.Random(20260908)
    values = [measure(randomizer.choices(blocks, k=len(blocks))) for _ in range(20_000)]
    return percentiles(values) if all(value is not None for value in values) else None


def resource_comparison(blocks, field):
    eligible = [block for block in blocks if all(row['usageComplete'] for arm in ['final', COMPARATOR] for row in block[arm])] if field in ['tokens', 'cost'] else blocks
    values = [ratio([block], field) for block in eligible]
    leave_one_out = [ratio(eligible[:index] + eligible[index + 1:], field) for index in range(len(eligible))] if len(eligible) > 1 else []
    return {'taskClusters': len(eligible), 'allTaskClusters': len(blocks),
            'completeUsageSelection': field in ['tokens', 'cost'] and len(eligible) != len(blocks),
            'ratio': ratio(eligible, field), 'taskClusterBootstrap95': bootstrap(eligible, lambda sample: ratio(sample, field)),
            'medianTaskRatio': statistics.median(values) if values and all(value is not None for value in values) else None,
            'leaveOneTaskOutRange': [min(leave_one_out), max(leave_one_out)] if leave_one_out and all(value is not None for value in leave_one_out) else None}


def subset(rows):
    blocks = paired_blocks(rows)
    return {'trials': len(rows), 'taskClusters': len(blocks),
            'successDifference': success_difference(blocks) if blocks else None,
            'successDifferenceTaskClusterBootstrap95': bootstrap(blocks, success_difference),
            'resources': {field: resource_comparison(blocks, field) for field in FIELDS}}


def per_repetition(rows):
    result = {}
    for repetition in [1, 2]:
        arms = {}
        for arm in ['final', COMPARATOR]:
            selected = [row for row in rows if row['repetition'] == repetition and row['arm'] == arm]
            arms[arm] = {'trials': len(selected), 'passed': sum(row['auditedReward'] for row in selected),
                         'agentSeconds': sum(row['agentSeconds'] for row in selected) if selected and all(row['agentSeconds'] is not None for row in selected) else None,
                         'missingAgentDuration': sum(row['agentSeconds'] is None for row in selected),
                         'incompleteUsage': sum(not row['usageComplete'] for row in selected)}
        result[repetition] = arms
    return result


def validate_calculation():
    blocks = [{'final': [{'agentSeconds': 5, 'auditedReward': 1}] * 2,
               'cline': [{'agentSeconds': 10, 'auditedReward': 1}] * 2}] * 3
    assert ratio(blocks, 'agentSeconds') == 0.5
    assert bootstrap(blocks, lambda sample: ratio(sample, 'agentSeconds')) == [0.5, 0.5]
    assert success_difference(blocks) == 0
    assert ratio([{'final': [{'tokens': None}], 'cline': [{'tokens': 1}]}], 'tokens') is None


def compare(rows):
    selected = [row for row in rows if row['arm'] in ['final', COMPARATOR]]
    return {'all': subset(selected),
            'fresh': subset([row for row in selected if not row['seenBeforeCampaign']]),
            'seen': subset([row for row in selected if row['seenBeforeCampaign']]),
            'repetitions': per_repetition(selected),
            'withoutPreflightOverlapTask': subset([row for row in selected if row['task'] != 'dna-assembly'])}


def main():
    global COMPARATOR
    validate_calculation()
    data = json.loads((ROOT / 'results.json').read_text())
    rows = data['rows']
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    expected = {(task['id'], arm, repetition) for task in manifest['tasks']
                for arm in ['before', 'final', 'cline'] for repetition in [1, 2]}
    actual = {(row['task'], row['arm'], row['repetition']) for row in rows}
    assert len(rows) == len(expected) and actual == expected
    comparisons = {}
    for COMPARATOR in ['before', 'cline']:
        comparisons['finalVs' + COMPARATOR.title()] = compare(rows)
    attempted_as_failures = [dict(row, auditedReward=0) if row.get('audit', {}).get('attemptedOracleAccess') else row for row in rows]
    conservative = {}
    for COMPARATOR in ['before', 'cline']:
        conservative['finalVs' + COMPARATOR.title()] = compare(attempted_as_failures)
    result = {'note': 'Descriptive stratified task-cluster bootstrap, two repetitions retained. Missing usage is unknown. Failed trials are included. Ratios below one favor the candidate.',
              'comparisons': comparisons, 'summary': data['summary'],
              'oracleAttemptSensitivity': {'note': 'Additional conservative sensitivity: unsuccessful oracle searches also score zero. Primary adjudication retains the registered confirmed-access criterion. All times and usage remain included.', 'comparisons': conservative}}
    (ROOT / 'analysis.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
