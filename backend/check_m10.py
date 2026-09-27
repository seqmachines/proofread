"""M10 done-when: archive, discover and replay the selected 20 Codex baselines."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sys
from unittest.mock import patch
import urllib.request

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

import import_benchmark as importer
from db import get_db


def get(base, path):
    with urllib.request.urlopen(base + path, timeout=120) as response:
        return json.load(response)


def replay(base, run_id, last_seq):
    events = []
    with urllib.request.urlopen(f"{base}/runs/{run_id}/stream", timeout=120) as response:
        for line in response:
            if line.startswith(b"data: "):
                events.append(json.loads(line[6:]))
                if events[-1]["seq"] == last_seq:
                    return events
    raise AssertionError("SSE ended before the current run_finished")


def fold(events):
    states, transitions, checks = {}, {}, []
    revision, score = 1, None
    for e in events:
        if e['t'] in {'state_committed', 'transition_committed'}:
            key = 'state' if e['t'] == 'state_committed' else 'transition'
            (states if key == 'state' else transitions)[e[key]['id']] = e[key]
            revision = e['workflow_revision']
        elif e['t'] in {'state_revised', 'transition_revised'}:
            key = 'state' if e['t'] == 'state_revised' else 'transition'
            items = states if key == 'state' else transitions
            if e['after'] is None:
                items.pop(e[key + '_id'])
            else:
                items[e[key + '_id']] = e['after']
            revision = e['workflow_revision']
        elif e['t'] == 'verifier_check':
            checks.append({k: v for k, v in e.items() if k not in {'run_id', 'seq', 'ts', 't'}})
        elif e['t'] == 'benchmark_scored':
            score = {k: e[k] for k in ('benchmark_version', 'metrics')}
    return states, transitions, checks, revision, score


def check(base, root):
    records = importer.archive_files(root)
    selected = importer.selected_records(records)
    assert len(records) == len(selected) == 20
    print(f"Discovered {len(records)} result files; {len(selected)} system × protocol pairs.", flush=True)
    changed = importer.store_records(records)
    print(f"Archived {changed} new/updated files.", flush=True)
    db = get_db()
    # Prove a genuine older saved attempt updates in-place, with no synthetic
    # benchmark data and no removal of history. Only needed on the first import.
    prior = None
    groups = defaultdict(list)
    for r in records:
        if r['protocol_id']:
            groups[tuple(r[k] for k in importer.KEY_FIELDS)].append(r)
    for latest in selected:
        prepared = importer.prepare_record(latest)
        if db.runs.find_one({'_id': prepared['run_id']}, {'_id': 1}):
            continue
        for older in groups[tuple(latest[k] for k in importer.KEY_FIELDS)]:
            old = importer.prepare_record(older)
            if old['graph']['states'] and old['score'] != prepared['score']:
                importer.seed_protocols([old])
                importer.import_record(old)
                prior = (old['run_id'], list(db.events.find({'run_id': old['run_id']}, {'_id': 0}).sort('seq', 1)))
                break
        if prior:
            break
    # Make disk reads impossible during the actual normalization. All new runs,
    # protocol metadata, GT, scores and graphs must come from benchmark_records.
    with patch.object(importer, 'read_file', side_effect=AssertionError('Normalization read the filesystem')):
        count = importer.normalize_records()
    print(f"Normalized {count} new/updated runs from benchmark_records alone.", flush=True)
    archived = {r['_id']: r for r in db.benchmark_records.find({}, {'raw': 1, 'sha256': 1})}
    assert all(archived[r['_id']]['raw'] == r['raw'] and archived[r['_id']]['sha256'] == r['sha256'] for r in records)
    assert len(archived) == len(records)
    protocols = {p['id']: p for p in get(base, '/protocols')}
    sources = {}
    for protocol in protocols.values():
        for source in protocol['sources']:
            assert {'run_id', 'source', 'executor', 'model', 'harness_version'} <= source.keys()
            assert source.keys() <= {'run_id', 'source', 'executor', 'model', 'harness_version', 'benchmark_score'}
            if source['source'] == 'benchmark':
                key = tuple(source[k] if k != 'protocol_id' else protocol['id'] for k in importer.KEY_FIELDS)
                assert key not in sources, 'Duplicate imported system × protocol'
                sources[key] = source
    assert set(sources) == {tuple(r[k] for k in importer.KEY_FIELDS) for r in selected}

    def one(record):
        prepared = importer.prepare_record(record)
        source = sources[tuple(record[k] for k in importer.KEY_FIELDS)]
        run_id = source['run_id']
        snapshot = get(base, f'/runs/{run_id}')
        run, workflow = snapshot['run'], snapshot['workflow']
        assert run_id == prepared['run_id'] and run['source'] == 'benchmark'
        assert run['benchmark_record_id'] == record['_id'] and not run.get('baseline')
        assert workflow['gt_score'] is None
        assert workflow['benchmark_score'] == prepared['score'] == source['benchmark_score']
        assert {s['id']: s for s in workflow['states']} == {s['id']: s for s in prepared['graph']['states']}
        assert {t['id']: t for t in workflow['transitions']} == {t['id']: t for t in prepared['graph']['transitions']}
        events = get(base, f'/runs/{run_id}/events')
        assert events == replay(base, run_id, run['step'])
        assert [e['seq'] for e in events] == list(range(1, run['step'] + 1))
        assert events[0]['t'] == 'run_started' and events[-1]['t'] == 'run_finished'
        assert events[-2]['t'] == 'benchmark_scored'
        states, transitions, checks, revision, score = fold(events)
        assert list(states.values()) == workflow['states']
        assert list(transitions.values()) == workflow['transitions']
        assert checks == workflow['checks'] and revision == workflow['workflow_revision'] and score == workflow['benchmark_score']
        assert protocols[run['protocol_id']]['has_gt'] == bool(prepared['truth'])
        return {'events': len(events), 'states': len(states), 'transitions': len(transitions),
                'unscored': not bool(score['metrics']), 'failed': run['status'] == 'failed'}

    totals = Counter()
    with ThreadPoolExecutor(max_workers=4) as pool:
        for n, result in enumerate(pool.map(one, selected), 1):
            totals.update(result)
            if n % 100 == 0:
                print(f"Verified API discovery and SSE replay: {n}/{len(selected)}", flush=True)
    if prior:
        current = get(base, f'/runs/{prior[0]}/events')
        assert current[:len(prior[1])] == prior[1] and len(current) > len(prior[1])
        assert any(e['t'] in {'state_revised', 'transition_revised'} for e in current)
        print(f"Real older → latest attempt updated {prior[0]} with all earlier events preserved.", flush=True)
    before = {r['_id']: r['step'] for r in db.runs.find({'source': 'benchmark'}, {'step': 1})}
    assert importer.store_records(records) == 0
    with patch.object(importer, 'read_file', side_effect=AssertionError('Normalization read the filesystem')):
        assert importer.normalize_records() == 0
    assert before == {r['_id']: r['step'] for r in db.runs.find({'source': 'benchmark'}, {'step': 1})}
    print(json.dumps({'records': len(records), 'pairs': len(selected), 'protocols': len(protocols),
                      'systems': len({tuple(r[k] for k in importer.KEY_FIELDS[:-1]) for r in selected}), **totals}))
    print('M10 DONE-WHEN PASSED', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path, nargs='?', default=importer.RUNS_ROOT)
    parser.add_argument('--base', default='http://127.0.0.1:8000')
    args = parser.parse_args()
    check(args.base.rstrip('/'), args.root)
