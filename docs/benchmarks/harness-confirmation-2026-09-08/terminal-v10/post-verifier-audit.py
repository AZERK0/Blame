import json
import sys
from datetime import datetime
from pathlib import Path


def read(path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None


def inspect(config):
    root = config.parent
    result = read(root / 'result.json')
    start = (result.get('verifier') or {}).get('started_at')
    cutoff = timestamp(start)
    event_path = root / 'agent/events.jsonl'
    late, calls, malformed = [], [], 0
    for line in event_path.read_text().split('\n') if event_path.exists() else []:
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            malformed += 1
            continue
        if cutoff and timestamp(record['recordedAt']) > cutoff:
            late.append({'at': record['recordedAt'], 'type': record['event']['type']})
            event = record['event']
            if event['type'] == 'tool' and event['payload'].get('phase') == 'started':
                calls.append({'at': record['recordedAt'], 'tool': event['payload']['toolCall']['name']})
    return {'trial': root.name, 'verifierStartedAt': start, 'lateEventCount': len(late),
            'lastLateEvent': late[-1] if late else None, 'postVerifierToolCalls': calls,
            'missingEvents': not event_path.exists(), 'malformedEventRows': malformed,
            'missingResult': not bool(result)}


root = Path(sys.argv[1])
rows = [inspect(path) for path in sorted((root / 'jobs').glob('*/*/config.json'))]
report = {'note': 'Recorder timestamps, not server-side execution clocks. Tool starts after verifier start indicate potential overlap and require trace review; non-tool telemetry alone is not proof of a workspace mutation.', 'trials': rows}
(root / 'post-verifier-audit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'trials': len(rows), 'postVerifierCalls': [(r['trial'],len(r['postVerifierToolCalls'])) for r in rows if r['postVerifierToolCalls']]}))
