import json
from pathlib import Path

import analyze

ROOT = Path(__file__).resolve().parent


def comparison(rows):
    analyze.COMPARATOR = 'cline'
    renamed = [dict(row, arm='final' if row['arm'] == 'before' else 'cline') for row in rows]
    return analyze.subset(renamed)


def repetitions(rows):
    result = {}
    for repetition in [1, 2]:
        result[repetition] = {}
        for arm in ['before', 'cline']:
            selected = [row for row in rows if row['repetition'] == repetition and row['arm'] == arm]
            result[repetition][arm] = {
                'passed': sum(row['auditedReward'] for row in selected),
                'agentSeconds': sum(row['agentSeconds'] for row in selected),
                'requests': sum(row['requests'] for row in selected),
            }
    return result


def main():
    data = json.loads((ROOT / 'results.json').read_text())
    rows = [row for row in data['rows'] if row['arm'] in ['before', 'cline']]
    contaminated = {row['task'] for row in rows if row['audit'].get('oracleConfirmed')}
    result = {
        'leftArm': 'before', 'rightArm': 'cline', 'postSelection': True,
        'note': 'Exploratory comparison after rejecting the finite-check prompt at c3b769ae. Three known diagnostic tasks, not a holdout or independent confirmation. Original official and audited rewards remain unchanged.',
        'all': comparison(rows), 'repetitions': repetitions(rows),
        'excludedOracleTaskClusters': sorted(contaminated),
        'withoutOracleTaskClusters': comparison([row for row in rows if row['task'] not in contaminated]),
    }
    (ROOT / 'retained-comparison.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'trials': len(rows), 'excludedOracleTaskClusters': sorted(contaminated)}))


if __name__ == '__main__':
    main()
