"""User-requested setup cleanup: retain only the original 20 Codex baselines.

Explicitly deletes other runs and their related data from proofread. The local
benchmark checkout and backend seed files are never changed.
"""

import json
import sys
from pathlib import Path

if __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_db
from import_benchmark import RUNS_ROOT, archive_files, prepare_record, store_records


def retain():
    records = archive_files(RUNS_ROOT)
    prepared = [prepare_record(r) for r in records]
    keep_runs = {r['run_id'] for r in prepared}
    keep_records = {r['_id'] for r in records}
    keep_protocols = {r['protocol_id'] for r in records}
    assert len(keep_runs) == len(keep_records) == len(keep_protocols) == 20
    db = get_db()
    # Validate the entire retained panel before the first deletion.
    for p in prepared:
        run = db.runs.find_one({'_id': p['run_id'], 'source': 'benchmark', 'status': 'done'})
        workflow = db.workflows.find_one({'run_id': p['run_id']})
        assert run and workflow, f"Missing completed baseline: {p['protocol_id']}"
        assert run['import_record']['harbor_run_id'] == p['provenance']['harbor_run_id']
        assert run['benchmark_record_id'] in keep_records
        assert workflow['benchmark_score'] == p['score']
    store_records(records)  # Also retain the panel summary in each archive's attachments.

    def cleanup(session):
        other_runs = list(db.runs.find({'_id': {'$nin': sorted(keep_runs)}}, {'status': 1}, session=session))
        if any(r['status'] not in {'done', 'failed'} for r in other_runs):
            raise ValueError('A run is still active; let it finish before pruning')
        run_ids = [r['_id'] for r in other_runs]
        record_ids = [r['_id'] for r in db.benchmark_records.find(
            {'_id': {'$nin': sorted(keep_records)}}, {'_id': 1}, session=session)]
        protocol_ids = [p['_id'] for p in db.protocols.find(
            {'_id': {'$nin': sorted(keep_protocols)}}, {'_id': 1}, session=session)]
        review_ids = [r['_id'] for r in db.reviews.find({'run_id': {'$in': run_ids}}, {'_id': 1}, session=session)]
        deleted = {}
        for collection in ('events', 'workflows', 'signals', 'reviews'):
            deleted[collection] = db[collection].delete_many({'run_id': {'$in': run_ids}}, session=session).deleted_count
        deleted['entities'] = db.entities.delete_many({'$or': [
            {'provenance.run_id': {'$in': run_ids}}, {'provenance.review_id': {'$in': review_ids}},
        ]}, session=session).deleted_count
        deleted['runs'] = db.runs.delete_many({'_id': {'$in': run_ids}}, session=session).deleted_count
        deleted['benchmark_records'] = db.benchmark_records.delete_many(
            {'_id': {'$in': record_ids}}, session=session).deleted_count
        deleted['chunks'] = db.chunks.delete_many({'protocol_id': {'$in': protocol_ids}}, session=session).deleted_count
        # User-authorized setup deletion only; runtime GT reads stay in verifier.py.
        deleted['ground_truth'] = db.ground_truth.delete_many(
            {'protocol_id': {'$in': protocol_ids}}, session=session).deleted_count
        deleted['protocols'] = db.protocols.delete_many({'_id': {'$in': protocol_ids}}, session=session).deleted_count
        assert db.runs.count_documents({}, session=session) == 20
        assert db.workflows.count_documents({}, session=session) == 20
        assert db.benchmark_records.count_documents({}, session=session) == 20
        assert db.protocols.count_documents({}, session=session) == 20
        return deleted

    with db.client.start_session() as session:
        deleted = session.with_transaction(cleanup)
    return {'kept_runs': 20, 'kept_protocols': 20, 'kept_records': 20, 'deleted': deleted}


if __name__ == '__main__':
    print(json.dumps(retain(), indent=2))
