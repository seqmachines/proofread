"""M11 done-when: authenticated curl review with EXECUTOR=none, then remove test data.

Run with port 8000 free. Uses temporary runs/chunks in the configured proofread
DB; never edits a saved benchmark run. Starts and stops its own local API.
"""

from copy import deepcopy
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from uuid import uuid4

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_db
from engine import emit

BASE = 'http://127.0.0.1:8000'


def get(path):
    with urlopen(BASE + path, timeout=60) as response:
        return json.load(response)


def main():
    db = get_db()
    baseline = {r['_id']: r['step'] for r in db.runs.find({}, {'step': 1})}
    assert len(baseline) == 20, 'Run after the selected-panel import/cleanup'
    token = secrets.token_urlsafe(32)
    env = {**os.environ, 'EXECUTOR': 'none', 'CODEX_MODEL': '',
           'REVIEW_TOKENS': f'{token}:M11 integration check:curator', 'STREAM_MODE': 'poll'}
    run_ids, chunk_ids, review_ids = [], [], []
    with tempfile.TemporaryDirectory(prefix='proofread-m11-') as directory:
        root = Path(directory)
        # curl's config file keeps the token out of process arguments/output.
        config = root / 'curl.conf'
        config.write_text(f'header = "X-Review-Token: {token}"\n')
        config.chmod(0o600)
        log = (root / 'server.log').open('w+')
        process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app:app', '--app-dir', 'backend',
                                    '--host', '127.0.0.1', '--port', '8000'], env=env, stdout=log, stderr=log)
        def post(path, body, authenticated=True):
            body_file, response_file = root / 'body.json', root / 'response.json'
            body_file.write_text(json.dumps(body))
            args = ['curl', '--silent', '--show-error', '--max-time', '120', '-X', 'POST',
                    '-H', 'Content-Type: application/json', '--data-binary', '@' + str(body_file),
                    '-o', str(response_file), '-w', '%{http_code}']
            if authenticated:
                args += ['--config', str(config)]
            status = subprocess.check_output([*args, BASE + path], text=True)
            return int(status), json.loads(response_file.read_text())
        def review(run_id, target, decision, after=None, error_type=None):
            workflow = get(f'/runs/{run_id}')['workflow']
            before = next(x for x in workflow['states'] + workflow['transitions'] if x['id'] == target)
            body = {'run_id': run_id, 'workflow_revision': workflow['workflow_revision'], 'target_id': target,
                    'decision': decision, 'before': before, 'after': after,
                    'note': 'M11 integration check: synthetic review data, removed after verification.',
                    'error_type': error_type, 'systematic': decision in {'modify', 'reject'}}
            status, response = post(f'/runs/{run_id}/reviews', body)
            assert status == 200, (status, response)
            review_ids.append(response['review_id'])
            return body, response
        try:
            for _ in range(100):
                if process.poll() is not None:
                    log.seek(0)
                    raise AssertionError(log.read())
                try:
                    if get('/config')['executor'] == 'none':
                        break
                except (URLError, HTTPError):
                    pass
                time.sleep(.1)
            assert get('/config') == {'executor': 'none', 'live_runs': False, 'stream_mode': 'poll'}
            assert post('/runs', {'protocol_id': 'sci_rna_seq', 'executor': 'codex'})[0] == 501
            for path in ('/runs/missing/reviews', '/runs/missing/messages', '/runs/missing/patches/p/apply',
                         '/harness/evolve', '/harness/gate/v0', '/import'):
                assert post(path, {}, False)[0] == 401
            for protocol in ('sci_rna_seq', 'smart_seq'):
                run_id = 'm11-check-' + uuid4().hex
                run_ids.append(run_id)
                chunk_id = run_id + ':evidence'
                chunk_ids.append(chunk_id)
                db.chunks.insert_one({'_id': chunk_id, 'protocol_id': protocol, 'page': 1, 'kind': 'page',
                                      'text': 'M11 synthetic test evidence. Not protocol evidence.', 'source_file': 'M11 check'})
                emit(run_id, 'run_started', protocol_id=protocol, harness_version='m11-check', executor='none', source='live')
                top = [{'name': 'RT handle', 'type': 'handle', 'origin': 'llm'},
                       {'name': 'cDNA insert', 'type': 'insert', 'origin': 'llm'}]
                for sid in ('S1', 'S2', 'S3'):
                    state = {'id': sid, 'label': f'M11 synthetic {sid}',
                             'strands': {'top': top, 'bottom': list(reversed(top)) if sid == 'S2' else []},
                             'origin': 'llm', 'evidence': [chunk_id], 'skill_call_id': None,
                             'review_status': 'unreviewed', 'stale_since_revision': None}
                    emit(run_id, 'state_committed', state=state, workflow_revision=1)
                for tid, a, b, op in [('T1', 'S1', 'S2', 'reverse_transcription'), ('T2', 'S2', 'S3', 'pcr')]:
                    emit(run_id, 'transition_committed', workflow_revision=1, transition={
                        'id': tid, 'from': a, 'to': b, 'op': op, 'skill_call_id': None,
                        'evidence': [chunk_id], 'oligos': [], 'discarded': []})
                for sid in ('S2', 'S3'):
                    emit(run_id, 'verifier_check', check='m11_synthetic_check', status='fail', state_id=sid,
                         message='Synthetic integration check requiring a review.')
                emit(run_id, 'run_finished', status='done')
            run_id = run_ids[0]
            after = deepcopy(next(s for s in get(f'/runs/{run_id}')['workflow']['states'] if s['id'] == 'S2'))
            after['strands']['bottom'].reverse()
            body, result = review(run_id, 'S2', 'modify', after, 'strand_or_orientation_error')
            assert result['workflow_revision'] == 2
            assert set(result['derived']) == {'signal_id', 'memory_candidate_id'}
            document = db.reviews.find_one({'_id': result['review_id']})
            signal = db.signals.find_one({'_id': result['derived']['signal_id']})
            memory = db.entities.find_one({'_id': result['derived']['memory_candidate_id']})
            assert document['reviewer']['name'] == 'M11 integration check' and document['reviewer']['role'] == 'curator'
            assert signal['source'] == 'human' and signal['systematic'] and signal['review_id'] == document['_id']
            assert signal['error_type'] == 'strand_or_orientation_error'
            assert memory['provenance'] == {'review_id': document['_id']} and not memory['verified']
            snapshot = get(f'/runs/{run_id}')
            assert snapshot['workflow']['gt_score'] is not None and not snapshot['run'].get('baseline')
            assert next(s for s in snapshot['workflow']['states'] if s['id'] == 'S2')['review_status'] == 'modified'
            assert next(s for s in snapshot['workflow']['states'] if s['id'] == 'S3')['stale_since_revision'] == 2
            row = next(r for r in get('/queue') if r['run_id'] == run_id)
            assert row['unreviewed_failed_checks'] == 1 and row['score'] is not None
            assert all(m['_id'] != memory['_id'] for m in get('/memory'))
            print('curl modify passed: review + repair + score + human signal + unverified memory + queue.', flush=True)
            # Replayed/stale or impersonated requests must not write anything.
            step = snapshot['run']['step']
            assert post(f'/runs/{run_id}/reviews', body)[0] == 409
            assert post(f'/runs/{run_id}/reviews', {**body, 'reviewer': {'name': 'forged'}})[0] == 422
            assert post(f'/runs/{run_id}/reviews', {**body, 'error_type': None})[0] == 422
            assert get(f'/runs/{run_id}')['run']['step'] == step
            _, unresolved = review(run_id, 'S3', 'unresolved')
            assert unresolved['workflow_revision'] == 2 and unresolved['derived'] == {}
            assert next(r for r in get('/queue') if r['run_id'] == run_id)['unresolved'] == 1
            assert get(f'/runs/{run_id}')['run']['verified_through_revision'] is None
            review(run_id, 'S2', 'accept')
            # Same symbolic molecule accepted in another protocol verifies the memory.
            other = run_ids[1]
            after2 = deepcopy(next(s for s in get(f'/runs/{other}')['workflow']['states'] if s['id'] == 'S2'))
            after2['strands']['bottom'].reverse()
            review(other, 'S2', 'modify', after2, 'strand_or_orientation_error')
            review(other, 'S2', 'accept')
            assert db.entities.find_one({'_id': memory['_id']})['verified']
            assert any(m['_id'] == memory['_id'] for m in get('/memory?operation=reverse_transcription&type=state'))
            review(run_id, 'T2', 'reject', error_type='workflow_or_topology_error')
            assert get(f'/runs/{run_id}')['workflow']['workflow_revision'] == 3
            review(run_id, 'S2', 'reject', error_type='workflow_or_topology_error')
            workflow = get(f'/runs/{run_id}')['workflow']
            assert workflow['workflow_revision'] == 4
            assert {s['id'] for s in workflow['states']} == {'S1', 'S3'} and not workflow['transitions']
            events = get(f'/runs/{run_id}/events')
            assert [e['seq'] for e in events] == list(range(1, len(events) + 1))
            assert events[-1]['t'] == 'run_finished'
            assert len([e for e in events if e['t'] == 'review_recorded']) == len(get(f'/runs/{run_id}/reviews'))
            for mode in ('version', 'executor', 'protocol'):
                rows = get('/benchmark?group_by=' + mode)
                assert sum(r['runs'] for r in rows) == 22
                assert any(r['benchmark_score'] and r['benchmark_score']['benchmark_version'] == '4.6.0' for r in rows)
                assert any(r['gt_score'] for r in rows)
            print('Auth, stale-write rejection, accept/unresolved/reject, memory verification, and score views passed.', flush=True)
        finally:
            process.terminate()
            process.wait(timeout=15)
            log.close()
            def cleanup(session):
                ids = [r['_id'] for r in db.reviews.find({'run_id': {'$in': run_ids}}, {'_id': 1}, session=session)]
                db.entities.delete_many({'provenance.review_id': {'$in': ids}}, session=session)
                for name in ('events', 'workflows', 'signals', 'reviews'):
                    db[name].delete_many({'run_id': {'$in': run_ids}}, session=session)
                db.runs.delete_many({'_id': {'$in': run_ids}}, session=session)
                db.chunks.delete_many({'_id': {'$in': chunk_ids}}, session=session)
            with db.client.start_session() as session:
                session.with_transaction(cleanup)
    assert baseline == {r['_id']: r['step'] for r in db.runs.find({}, {'step': 1})}
    print('M11 DONE-WHEN PASSED; temporary test data removed, original 20 baselines unchanged.', flush=True)


if __name__ == '__main__':
    main()
