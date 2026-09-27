"""Authenticated human review capture and transactional repair/signal/memory fan-out."""

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from uuid import uuid4

from agent import downstream
from db import get_db
from engine import emit
from molecules import MoleculeState, Transition, symbolic
from review_models import Signal
from seed import structural, validate_structure
from verifier import compare_ground_truth


class ReviewConflict(ValueError):
    pass


def latest_reviews(reviews):
    return {r['target_id']: r for r in sorted(reviews, key=lambda r: (r['created_at'], r['_id']))}


def review_need(workflow, reviews):
    latest = latest_reviews(reviews)
    def current(target):
        review = latest.get(target)
        state = next((s for s in workflow.get('states', []) if s['id'] == target), {})
        if review and (state.get('stale_since_revision') or 0) > review['workflow_revision']:
            return None
        return review
    failures = [c for c in workflow.get('checks', []) if c['status'] == 'fail']
    unreviewed = sum(not c.get('state_id') or current(c['state_id']) is None for c in failures)
    unresolved = sum(r['decision'] == 'unresolved' for r in latest.values())
    verified = unreviewed == 0 and unresolved == 0
    return unreviewed, unresolved, verified


def validate_after(before, after, is_state, workflow):
    if after['id'] != before['id']:
        raise ValueError('A review cannot change the target ID')
    if is_state:
        core = {k: v for k, v in after.items() if k != 'benchmark_structure'}
        MoleculeState.model_validate(core)
        native = after.get('benchmark_structure')
        if native is not None:
            if structural(native) != native:
                raise ValueError('benchmark_structure must contain only symbolic structural fields')
            validate_structure(native)
            if native['state_id'] != after['id']:
                raise ValueError('Native structure must belong to the reviewed state')
            if after['strands'] != before['strands'] and native == before.get('benchmark_structure'):
                raise ValueError('Update benchmark_structure with the preview, or explicitly omit it; the scorer uses the native structure')
        after['origin'] = 'human'
        after['review_status'] = 'modified'
        after['stale_since_revision'] = None
    else:
        Transition.model_validate(after)
        ids = {s['id'] for s in workflow['states']}
        if not {after['from'], after['to'], *after.get('discarded', [])} <= ids:
            raise ValueError('Transition endpoints must reference existing states')
        if after['to'] in after.get('discarded', []):
            raise ValueError('A product cannot be both carried and discarded')
    return after


def memory_key(item, operation, is_state, workflow):
    def molecule(state):
        value = {'strands': {k: [{n: s[n] for n in ('name', 'type')} for s in v]
                             for k, v in state['strands'].items()}}
        if state.get('benchmark_structure'):
            value['benchmark_structure'] = state['benchmark_structure']
        return value
    if is_state:
        value = molecule(item)
    else:
        states = {s['id']: s for s in workflow['states']}
        value = {'substrate': molecule(states[item['from']]), 'product': molecule(states[item['to']]),
                 'discarded': [molecule(states[s]) for s in item.get('discarded', [])],
                 'oligos': item.get('oligos', [])}
    raw = json.dumps({'operation': operation, 'value': value}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def record_review(run_id, request, reviewer):
    if request.run_id != run_id:
        raise ValueError('Body run_id must match the route')
    symbolic(request.note)
    db = get_db()
    review_id = 'rev_' + uuid4().hex
    signal_id, memory_id = 'sig_' + uuid4().hex, 'mem_' + uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()

    def write(session):
        run = db.runs.find_one({'_id': run_id}, session=session)
        workflow = db.workflows.find_one({'run_id': run_id}, session=session)
        if not run or not workflow:
            raise LookupError('Run not found')
        if run['status'] not in {'done', 'failed'}:
            raise ReviewConflict('Finish reconstruction before recording a review')
        if workflow['workflow_revision'] != request.workflow_revision:
            raise ReviewConflict('Workflow changed; reload before reviewing')
        state = next((s for s in workflow['states'] if s['id'] == request.target_id), None)
        transition = next((t for t in workflow['transitions'] if t['id'] == request.target_id), None)
        if state is not None and transition is not None:
            raise ValueError('Target ID is ambiguous between a state and transition')
        before = state if state is not None else transition
        if before is None:
            raise ReviewConflict('Review target no longer exists')
        if before != request.before:
            raise ReviewConflict('Target changed; reload before reviewing')
        is_state = state is not None
        after = validate_after(before, deepcopy(request.after), is_state, workflow) if request.after is not None else None
        changed = request.decision in {'modify', 'reject'}
        revision = workflow['workflow_revision'] + int(changed)
        protocol = db.protocols.find_one({'_id': run['protocol_id']}, session=session)
        if protocol is None:
            raise ValueError('Run protocol is missing')
        operations = {t['op'] for t in workflow['transitions'] if t['to'] == request.target_id} if is_state else {before['op']}
        operation = next(iter(operations)) if len(operations) == 1 else 'other'
        document = {**request.model_dump(), '_id': review_id, 'workflow_revision': revision,
                    'before': before, 'after': after, 'reviewer': reviewer, 'created_at': created_at}
        derived = {}
        def send(t, **payload):
            return emit(run_id, t, _session=session, _review_revision=revision, **payload)
        if changed:
            if is_state:
                stale = sorted(downstream(workflow, request.target_id) - {request.target_id})
                if after is None:
                    for old in workflow['transitions']:
                        if request.target_id in {old['from'], old['to']}:
                            replacement = None
                        elif request.target_id in old.get('discarded', []):
                            replacement = {**old, 'discarded': [s for s in old['discarded'] if s != request.target_id]}
                        else:
                            continue
                        send('transition_revised', transition_id=old['id'], before=old, after=replacement,
                             caused_by=review_id, workflow_revision=revision)
                send('state_revised', state_id=request.target_id, before=before, after=after,
                     caused_by=review_id, workflow_revision=revision, stale=stale)
            else:
                send('transition_revised', transition_id=request.target_id, before=before, after=after,
                     caused_by=review_id, workflow_revision=revision)
                roots = {before['to'], *(before.get('discarded', []))}
                if after:
                    roots.update([after['to'], *after.get('discarded', [])])
                stale = roots | {sid for root in roots for sid in downstream(workflow, root)}
                for original in workflow['states']:
                    if original['id'] in stale:
                        send('state_revised', state_id=original['id'], before=original,
                             after={**original, 'stale_since_revision': revision},
                             caused_by=review_id, workflow_revision=revision, stale=[])
            workflow = db.workflows.find_one({'run_id': run_id}, session=session)
            if protocol['has_gt']:
                comparison = compare_ground_truth(run_id, workflow=workflow, session=session,
                                                  review_target_id=request.target_id if after else None)
                send('gt_scored', **comparison['scores'])
                # M11 flags only: adjudication/export are separate modules.
                document['gt_candidate'] = bool(after and comparison['review_target_disagrees'])
            evidence = (after or before).get('evidence', [])
            signal = {'_id': signal_id, 'run_id': run_id, 'protocol_id': run['protocol_id'],
                      'harness_version': run['harness_version'], 'source': 'human',
                      'signature': f'{request.error_type}×{operation}', 'error_type': request.error_type,
                      'operation': operation, 'state_id': request.target_id if is_state else before['to'],
                      'evidence': evidence, 'root_cause': request.note or f'Human {request.decision} of {request.target_id}',
                      'recommended_action': f'Apply the confirmed {request.decision} in review {review_id}.',
                      'harness_relevance': 'high' if request.systematic else 'low',
                      'systematic': request.systematic, 'proposed_patch': None, 'processed': False,
                      'review_id': review_id, 'created_at': created_at}
            Signal.model_validate(signal)
            db.signals.insert_one(signal, session=session)
            derived['signal_id'] = signal_id
        item = after if request.decision == 'modify' else before
        if request.decision == 'modify' or (request.decision == 'accept' and item.get('evidence')):
            key = memory_key(item, operation, is_state, workflow)
            entity = {'_id': memory_id, 'name': item.get('label', item['id']),
                      'type': 'state' if is_state else 'transition', 'aliases': [], 'operation': operation,
                      'substrate': next((t['from'] for t in workflow['transitions'] if t['to'] == item['id']), None) if is_state else item['from'],
                      'assay_family': protocol['family'], 'verified': False,
                      'provenance': {'review_id': review_id}, 'created_at': created_at,
                      'protocol_id': run['protocol_id'], 'memory_key': key, 'decision': request.decision,
                      'value': item}
            db.entities.insert_one(entity, session=session)
            if request.decision == 'accept' and db.entities.find_one({
                'memory_key': key, 'decision': 'accept', 'protocol_id': {'$ne': run['protocol_id']},
            }, session=session):
                db.entities.update_many({'memory_key': key}, {'$set': {'verified': True}}, session=session)
            derived['memory_candidate_id'] = memory_id
        db.reviews.insert_one(document, session=session)
        reviews = list(db.reviews.find({'run_id': run_id}, session=session))
        _, _, verified = review_need(workflow, reviews)
        flags = {'verified_through_revision': revision if verified else None}
        if document.get('gt_candidate'):
            flags['gt_candidate'] = True
        send('review_recorded', review_id=review_id, target_id=request.target_id, decision=request.decision,
             reviewer=reviewer, note=request.note, review_flags=flags)
        send('run_finished', status=run['status'])
        return {'review_id': review_id, 'workflow_revision': revision, 'derived': derived}

    with db.client.start_session() as session:
        return session.with_transaction(write)
