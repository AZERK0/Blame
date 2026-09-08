import json
from collections import Counter

from collect import ROOT, rows
from timing import timestamp


def inspect(path):
    counters = Counter()
    events = rows(path)
    for row in events:
        event = row['event']
        if event['type'] != 'tool' or event['payload'].get('phase') != 'finished':
            continue
        payload = event['payload']
        call = payload.get('toolCall', {})
        supplied, output = call.get('input', {}), payload.get('output')
        counters['finishedTools'] += 1
        count_completion(counters, call, output)
        if call.get('name') == 'edit_code' and isinstance(supplied, dict):
            count_edits(counters, supplied, output)
        if call.get('name') == 'read_code' and isinstance(output, dict):
            data = output.get('data', {})
            if isinstance(data, dict):
                counters['readView.' + str(data.get('view', 'unknown'))] += 1
        if call.get('name') == 'apply_patch':
            counters['nativePatchCalls'] += 1
    return {'trial': path.parent.parent.name, 'counts': dict(counters),
            'completionTiming': completion_timing(events)}


def request_count(events):
    contexts = sum(row['event'].get('payload', {}).get('kind') == 'context_composed' for row in events)
    iterations = sum(row['event'].get('payload', {}).get('message') == 'Agent iteration started.' for row in events)
    return max(contexts, iterations)


def completion_timing(events):
    starts = [index for index, row in enumerate(events)
              if row['event']['type'] == 'tool'
              and row['event']['payload'].get('phase') == 'started'
              and row['event']['payload'].get('toolCall', {}).get('name') == 'finish_task']
    if not starts:
        return None
    first = starts[0]
    return {'firstFinishAt': events[first]['recordedAt'],
            'requestsThroughFirstFinish': request_count(events[:first + 1]),
            'requestsAfterFirstFinish': request_count(events) - request_count(events[:first + 1]),
            'secondsFromFirstFinishToLastEvent': timestamp(events[-1]['recordedAt']) - timestamp(events[first]['recordedAt'])}


def count_completion(counters, call, output):
    if call.get('name') == 'finish_task':
        counters['finishCalls'] += 1
        counters['finishErrors'] += isinstance(output, dict) and bool(output.get('error'))
    if call.get('name') == 'run_task' and str(call.get('id', '')).endswith(':validation'):
        counters['automaticValidationCalls'] += 1


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
