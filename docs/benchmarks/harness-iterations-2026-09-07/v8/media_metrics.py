import hashlib
import json
from collections import Counter
from collect import ROOT, read, rows


def images(value):
    if isinstance(value, list):
        return [image for item in value for image in images(item)]
    if not isinstance(value, dict):
        return []
    if value.get('type') == 'image' and isinstance(value.get('data'), str):
        return [value]
    return [image for child in value.values() for image in images(child)]


def metrics(record):
    events = [row['event'] for row in rows(ROOT / 'jobs' / record['group'] / record['trial'] / 'agent/events.jsonl')]
    calls = [e['payload'] for e in events if e['type'] == 'tool' and e['payload'].get('phase') == 'finished']
    media = [image for call in calls for image in images(call.get('output'))]
    unique = {hashlib.sha256(image['data'].encode()).hexdigest(): len(image['data']) for image in media}
    phases = Counter(e['payload'].get('metadata', {}).get('phase') for e in events if e['type'] == 'raw' and e['payload'].get('reason') == 'auto_compaction')
    return {'trial': record['trial'], 'task': record['task'], 'arm': record['arm'], 'repetition': record['repetition'],
            'compactionPhases': dict(phases), 'nativeImageResults': len(media), 'uniqueNativeImages': len(unique),
            'encodedImageResultBytes': sum(len(image['data']) for image in media), 'uniqueEncodedImageBytes': sum(unique.values()),
            'replacementCharactersInToolOutputs': sum(json.dumps(call.get('output'), ensure_ascii=False).count('\ufffd') for call in calls),
            'finishedToolNames': dict(Counter(call.get('toolCall', {}).get('name') for call in calls))}


def main():
    data = read(ROOT / 'results.json')
    records = [metrics(record) for record in data['rows'] if record['resultComplete']]
    report = {'note': 'Observed tool responses and compaction events only. Image byte counts are not provider tokens; recognized native image shapes can differ between tool implementations. Never fed to evaluated agents.', 'trials': records}
    (ROOT / 'media-metrics.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(records))


if __name__ == '__main__':
    main()
