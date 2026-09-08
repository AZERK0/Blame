import json
from collections import Counter

from collect import ROOT, rows


def inspect(path):
    counters = Counter()
    for row in rows(path):
        event = row['event']
        if event['type'] != 'tool' or event['payload'].get('phase') != 'finished':
            continue
        payload = event['payload']
        call = payload.get('toolCall', {})
        supplied, output = call.get('input', {}), payload.get('output')
        counters['finishedTools'] += 1
        if call.get('name') == 'edit_code' and isinstance(supplied, dict):
            count_edits(counters, supplied, output)
        if call.get('name') == 'read_code' and isinstance(output, dict):
            data = output.get('data', {})
            if isinstance(data, dict):
                counters['readView.' + str(data.get('view', 'unknown'))] += 1
        if call.get('name') == 'apply_patch':
            counters['nativePatchCalls'] += 1
    return {'trial': path.parent.parent.name, 'counts': dict(counters)}


def count_edits(counters, supplied, output):
    counters['editCalls'] += 1
    rejected = isinstance(output, dict) and output.get('status') == 'blocked'
    counters['rejectedEditCalls'] += rejected
    for operation in supplied.get('operations', []):
        if isinstance(operation, dict):
            kind = str(operation.get('kind', 'unknown'))
            counters['editOperation.' + kind] += 1
            counters['rejectedOperation.' + kind] += rejected


def main():
    records = [inspect(path) for path in sorted((ROOT / 'jobs').glob('*/*/agent/events.jsonl'))]
    report = {'note': 'Finished tool calls. Operation counts include rejected calls. Read views are observed outputs, including automatic symbol selection. Native patch calls and Blame patch operations are different units.', 'trials': records}
    (ROOT / 'operations.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'trials': len(records)}))


if __name__ == '__main__':
    main()
