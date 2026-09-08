from datetime import datetime


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def union_seconds(intervals):
    merged = []
    for start, finish in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(finish, merged[-1][1])
        else:
            merged.append([start, finish])
    return sum(finish - start for start, finish in merged)


def trace_intervals(events):
    model, tools, starts, pending = [], [], {}, None
    for row in events:
        event, time = row['event'], timestamp(row['recordedAt'])
        payload = event.get('payload', {})
        if payload.get('message') == 'Agent iteration started.':
            pending = time
        if event['type'] == 'usage' and pending is not None:
            model.append((pending, time))
            pending = None
        if event['type'] == 'tool' and payload.get('phase') == 'started':
            starts[payload['toolCallId']] = time
        if event['type'] == 'tool' and payload.get('phase') == 'finished':
            started = starts.pop(payload['toolCallId'], None)
            if started is not None:
                tools.append((started, time))
    return model, tools, pending, starts


def durations(events):
    model, tools, pending, starts = trace_intervals(events)
    return {'modelIntervalSeconds': union_seconds(model) if model else None,
            'completedToolUnionSeconds': union_seconds(tools),
            'classifiedUnionSeconds': union_seconds(model + tools),
            'modelIntervals': len(model), 'modelPendingAtEnd': pending is not None,
            'toolsPendingAtEnd': len(starts),
            'note': 'Iteration-start to provider-usage interval includes dispatch, network and provider time. Visible completed tool intervals are unioned to avoid double-counting parallel calls. Interrupted intervals remain explicitly pending and are not reported as zero-duration work.'}
