import json
from collect import ROOT, read


def paired(records, reference):
    groups = {}
    for row in records:
        groups.setdefault((row['task'], row['repetition']), {})[row['arm']] = row
    return [(group['final'], group[reference]) for group in groups.values()]


def comparison(records, reference):
    pairs = paired(records, reference)
    resources = {}
    for field in ['agentSeconds', 'tokens', 'cost', 'requests']:
        eligible = [(left, right) for left, right in pairs if field not in ['tokens', 'cost'] or (left['usageComplete'] and right['usageComplete'])]
        totals = [sum(pair[index][field] for pair in eligible) for index in [0, 1]]
        resources[field] = {'eligibleBlocks': len(eligible), 'allBlocks': len(pairs),
                            'finalTotal': totals[0], 'referenceTotal': totals[1],
                            'ratio': totals[0] / totals[1] if totals[1] else None}
    return {'reference': reference, 'resources': resources}


def main():
    data = read(ROOT / 'results.json')
    manifest = read(ROOT / 'manifest.json')
    expected = {(task, group['repetition'], arm) for group in manifest['groups'] for task in group['tasks'] for arm in group['armOrder']}
    actual = {(row['task'], row['repetition'], row['arm']) for row in data['rows']}
    assert len(data['rows']) == 9 and actual == expected
    result = {'note': 'Known diagnostic tasks. Financial has two repetitions, G-code one. No global inference. Incomplete usage is excluded pairwise for tokens/cost; failures remain. Ratios below one favor V8.',
              'comparisons': [comparison(data['rows'], arm) for arm in ['before', 'cline']], 'summary': data['summary']}
    (ROOT / 'analysis.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
