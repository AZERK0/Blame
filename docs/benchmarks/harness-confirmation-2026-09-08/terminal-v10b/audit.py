import json
import re
from pathlib import Path

from collect import ROOT, rows

PATTERNS = {'oracle_search': re.compile(r'answer[ _-]*key|benchmark (?:task wording|implementation)', re.I),
            'benchmark_reference': re.compile(r'terminal[-_ ]bench|tbench\.ai|harborframework|laude-institute', re.I),
            'oracle_path': re.compile(r'solution/solve\.sh|tests/test_outputs\.py|reference_illum|reward\.txt|/logs/verifier|/tests/'),
            'trajectory_reference': re.compile(r'huggingface\.co/datasets|trajectory\.json|trajectory\.jsonl|agent[._-]rollout', re.I)}
URL = re.compile(r'https?://[^\s<>\"\x27`\\]+')


def shortened(value, size=1200):
    return value if len(value) <= size else value[:size] + '…'


def matching_snippets(text):
    matches = []
    for kind, pattern in PATTERNS.items():
        for match in list(pattern.finditer(text))[:12]:
            matches.append({'kind': kind, 'offset': match.start(),
                            'snippet': text[max(0, match.start() - 160):match.end() + 220]})
    return matches


def inspect(path):
    started, finished, candidates, urls = 0, 0, [], set()
    for row in rows(path):
        event = row['event']
        if event['type'] != 'tool':
            continue
        payload = event['payload']
        started += payload.get('phase') == 'started'
        finished += payload.get('phase') == 'finished'
        call = payload.get('toolCall', {})
        tool_input = json.dumps(call.get('input', {}), ensure_ascii=False)
        tool_output = json.dumps(payload.get('output', {}), ensure_ascii=False)
        urls.update(URL.findall(tool_input))
        matches = matching_snippets(tool_input) + matching_snippets(tool_output)
        if matches:
            candidates.append({'line': row['line'], 'tool': call.get('name'), 'phase': payload.get('phase'),
                               'inputPreview': shortened(tool_input), 'matches': matches})
    return {'trial': path.parent.parent.name, 'path': str(path), 'started': started, 'finished': finished,
            'outboundUrls': sorted(urls), 'candidates': candidates}


def main():
    records = [inspect(path) for path in sorted((ROOT / 'jobs').glob('*/*/agent/events.jsonl'))
               if (path.parent.parent / 'result.json').exists()]
    report = {'note': 'Candidate finder only. Matches are not evidence of reward hacking without examining the concrete tool input/output and task context. Absence of matches does not prove no contamination. Audit inputs never feed the evaluated agents.',
              'trials': records}
    (ROOT / 'audit-candidates.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'trials': len(records), 'tools': sum(row['started'] for row in records),
                      'flaggedTrials': [(row['trial'], len(row['candidates'])) for row in records if row['candidates']]}))


if __name__ == '__main__':
    main()
