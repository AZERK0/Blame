"""Supersede, without overwriting, the F31 command-label-based review.

This replays explicit research-agent adjudications, not an independent behavioral
oracle. Original model events, patches, scores, reviews and financials stay intact.
"""
import copy
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OLD = REPO / 'docs/experiments/light-harness-edit-boundaries-f31-2026-10-16'
NEW = REPO / 'docs/experiments/light-harness-invocation-f33-2026-10-16'


def load(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    results = load(OLD / 'results.json')
    reviews = load(OLD / 'source-review.json')
    ledger = load(OLD / 'tool-ledger.json')
    decisions = copy.deepcopy(reviews['decisions'])
    corrections = []
    false_reason = 'required_exact_npm_wrappers_not_invoked'
    # Four full-delivery decisions, plus a fifth check-only decision. The other
    # thirteen are also retained; failed source/order/scope/reporting still fail.
    names = {
        '1-yaml-anchor-ranges-baseline',
        '2-yaml-anchor-ranges-baseline',
        '2-yaml-anchor-ranges-candidate',
        '3-yaml-anchor-ranges-candidate',
        '3-fast-glob-dynamic-filter-candidate',
    }
    assert {d['name'] for d in decisions if false_reason in d.get('criteriaFailures', [])} == names
    for decision in decisions:
        if decision['name'] not in names:
            continue
        old = copy.deepcopy(decision)
        decision['criteriaFailures'].remove(false_reason)
        decision['agentRequiredChecksPassed'] = True
        decision['fullRequestCriteriaPassed'] = not decision['criteriaFailures']
        # These were sensitivities under an incorrect execution premise; they
        # are no longer a relaxation of the registered exact-wrapper criterion.
        decision['resolvedProjectSensitivity'] = False
        decision['notes'] = (
            'F33 correction: the frozen executor uses npm run plus the catalog script name. '
            'The original returned command is a misleading script label, not the spawned executable. '
            'Required wrappers execute in the recorded order after the last edit. '
            + ('All other previously reviewed delivery/source/reporting criteria remain satisfied.'
               if decision['fullRequestCriteriaPassed'] else
               'Missing final delivery at maxIterations32 still prevents full acceptance.')
            + ' Original notes and all prior correction decisions remain in the F31 publication.'
        )
        corrections.append({'name': decision['name'], 'originalDecision': old,
                            'correctedDecision': copy.deepcopy(decision),
                            'reason': 'Correct false inference from returned command label; exact npm-wrapper criterion is unchanged.'})
    # A sixth explanation also contained the false premise, but its actual order
    # failure and lack of delivery remain. Preserve this as note-only correction.
    note = next(d for d in decisions if d['name'] == '3-fast-glob-dynamic-filter-baseline')
    old_note = note['notes']
    note['notes'] = ('F33 note correction: project compile/unit/E2E tasks use actual npm wrappers. '
                     'After the last edit the successful unit check precedes the required focused '
                     'check, and there is no final delivery at maxIterations32. Order/full acceptance '
                     'still fail. Other source/scope/no-solution judgments are unchanged.')
    by_name = {d['name']: d for d in decisions}
    rows = []
    for row in results['rows']:
        d = by_name[row['name']]
        # Keep per-request unknown usage/cache counters in the original artifact.
        rows.append({key: row[key] for key in [
            'name', 'id', 'arm', 'repetition', 'officialRuntimeSuccess',
            'independentFunctionalSuccess', 'manualBehaviorPassed', 'durationMs',
            'eventsSha256', 'diffSha256', 'scoreSha256', 'usage']})
        rows[-1].update(agentRequiredChecksPassed=d['agentRequiredChecksPassed'],
                        fullRequestCriteriaPassed=d['fullRequestCriteriaPassed'],
                        noSolutionRetrieval=d['noSolutionRetrieval'], criteriaFailures=d.get('criteriaFailures', []))
        rows[-1]['auditedSuccess'] = all(rows[-1][k] for k in [
            'officialRuntimeSuccess', 'independentFunctionalSuccess', 'manualBehaviorPassed',
            'agentRequiredChecksPassed', 'fullRequestCriteriaPassed', 'noSolutionRetrieval'])
    arms = {}
    for arm in ['baseline', 'candidate', 'cline']:
        subset = [r for r in rows if r['arm'] == arm]
        arms[arm] = {'trials': len(subset), **{
            name: sum(bool(r[field]) for r in subset) for name, field in {
                'official': 'officialRuntimeSuccess', 'endpoint': 'independentFunctionalSuccess',
                'behavior': 'manualBehaviorPassed', 'exactChecks': 'agentRequiredChecksPassed',
                'fullAudit': 'auditedSuccess'}.items()},
            'tokens': sum(r['usage']['input'] + r['usage']['output'] for r in subset),
            'costUsd': sum(r['usage']['cost'] for r in subset),
            'workerSeconds': sum(r['durationMs'] for r in subset) / 1000}
    comparisons = []
    for left, right in [('candidate', 'baseline'), ('baseline', 'cline'), ('candidate', 'cline')]:
        pairs = [(a, b) for a in rows for b in rows
                 if a['arm'] == left and b['arm'] == right and a['id'] == b['id']
                 and a['repetition'] == b['repetition'] and a['auditedSuccess'] and b['auditedSuccess']
                 and a['usage']['tokensCostReconciled'] and b['usage']['tokensCostReconciled']]
        resources = {}
        for metric, value in {
            'tokens': lambda r: r['usage']['input'] + r['usage']['output'],
            'cost': lambda r: r['usage']['cost'], 'seconds': lambda r: r['durationMs'] / 1000}.items():
            a = sum(value(a) for a, _ in pairs)
            b = sum(value(b) for _, b in pairs)
            resources[metric] = {'left': a, 'right': b, 'relativeChange': a / b - 1 if b else None}
        comparisons.append({'left': left, 'right': right, 'pairs': len(pairs),
                            'names': [[a['name'], b['name']] for a, b in pairs], 'resources': resources})
    primary = comparisons[0]
    quality = all(
        sum(r['auditedSuccess'] for r in rows if r['id'] == task and r['arm'] == 'candidate') >=
        sum(r['auditedSuccess'] for r in rows if r['id'] == task and r['arm'] == 'baseline') and
        sum(r['manualBehaviorPassed'] for r in rows if r['id'] == task and r['arm'] == 'candidate') >=
        sum(r['manualBehaviorPassed'] for r in rows if r['id'] == task and r['arm'] == 'baseline')
        for task in {r['id'] for r in rows})
    resource = bool(primary['pairs']) and (
        primary['resources']['tokens']['relativeChange'] <= -.1 or
        primary['resources']['cost']['relativeChange'] <= -.1) and (
        primary['resources']['cost']['relativeChange'] <= .05 and
        primary['resources']['seconds']['relativeChange'] <= .1)
    reconstructed = []
    for trial in ledger:
        for index, call in enumerate(trial['tools']):
            output = call.get('output')
            data = output.get('data', {}) if isinstance(output, dict) else {}
            if call.get('tool') != 'run_task' or call.get('input', {}).get('kind') != 'project' or not isinstance(data.get('command'), str):
                continue
            task = call['input']['task']
            assert task in {'build:node', 'test:types', 'compile', 'test', 'test:e2e'}
            args = call['input'].get('args', [])
            reconstructed.append({'name': trial['name'], 'toolIndexZeroBased': index,
                                  'sequenceNumber': call.get('sequenceNumber'), 'input': call['input'],
                                  'originalReturnedCommand': data['command'],
                                  'reconstructedInvocation': {'executable': 'npm', 'args': ['run', task] + (['--'] + args if args else []), 'cwd': '.'},
                                  'evidence': 'inference from frozen taskInvocation/executeProjectTask and recorded catalog input; not a historical spawn log'})
    inputs = {f: sha(OLD / f) for f in [
        'protocol.json', 'results.json', 'source-review.json', 'tool-ledger.json',
        'validation-provenance.json', 'execution-bindings.json', 'decision.json',
        'review-corrections.json', 'guidance-summary.json', 'resolved-project-sensitivity.json']}
    return {'format': 'blame-invocation-review-correction-v1', 'paidRequests': 0,
            'method': 'Separate superseding research-agent audit; same exact-command criteria, original F31 publication bytes preserved. Not new model results.',
            'originalPublicationSha256': inputs,
            'processProofSha256': sha(NEW / 'process-before.json'),
            'corrections': corrections,
            'noteOnlyCorrections': [{'name': note['name'], 'originalNotes': old_note, 'correctedNotes': note['notes']}],
            'reconstructedProjectInvocations': reconstructed,
            'rows': rows, 'arms': arms, 'comparisons': comparisons,
            'qualityGate': quality, 'resourceGate': resource,
            'decision': 'investigate-quality-gap' if not quality else 'no-model-efficiency-claim',
            'limitation': 'Unblinded post-hoc reviewer correction. Repetitions on two task clusters are dependent; no model rerun, source repair or population superiority. Restored grades measure corrected interpretation, not a runtime success gain.'}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    output = build()
    destination = NEW / 'corrected-f31-audit.json'
    if args.verify:
        assert load(destination) == output, 'Corrected audit is inconsistent with original evidence or arithmetic'
    else:
        destination.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({k: output[k] for k in ['arms', 'qualityGate', 'resourceGate', 'decision']}))
