"""Resolve review tokens to server-owned reviewer identities."""

import hashlib
import os
import secrets
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from db import get_db


def reviewer_for_token(token):
    for entry in os.getenv('REVIEW_TOKENS', '').split(','):
        parts = entry.strip().split(':', 2)
        if len(parts) != 3:
            continue
        expected, name, role = parts
        if expected and name and role in {'curator', 'author'} and token and secrets.compare_digest(token, expected):
            return {'id': hashlib.sha256(expected.encode()).hexdigest()[:24], 'name': name, 'role': role}
    if token:
        invite = get_db().invites.find_one({'_id': hashlib.sha256(token.encode()).hexdigest()})
        if invite:
            return {'id': invite['invite_id'], 'name': invite['name'], 'role': 'author',
                    'protocol_id': invite['protocol_id']}
    raise HTTPException(status_code=401, detail='A valid X-Review-Token is required')


def requires_review_token(method, path):
    return (path == '/invites' and method in {'GET', 'POST'}) or (method == 'POST' and
            (path in {'/runs', '/import'} or path.startswith(('/runs/', '/harness/'))))


def require_protocol(reviewer, protocol_id):
    if reviewer['role'] != 'curator' and reviewer.get('protocol_id') != protocol_id:
        raise HTTPException(status_code=403, detail='This author can only review the invited protocol')


def authorize(reviewer, path):
    if path in {'/invites', '/import'} or path.startswith('/harness/'):
        if reviewer['role'] != 'curator':
            raise HTTPException(status_code=403, detail='This action requires a curator')
    elif path.startswith('/runs/'):
        run_id = path.split('/')[2]
        run = get_db().runs.find_one({'_id': run_id}, {'protocol_id': 1})
        if run is None:
            raise HTTPException(status_code=404, detail='Run not found')
        require_protocol(reviewer, run['protocol_id'])


def create_invite(protocol_id, name):
    db = get_db()
    if db.protocols.find_one({'_id': protocol_id}, {'_id': 1}) is None:
        raise HTTPException(status_code=404, detail='Protocol not found')
    token = secrets.token_urlsafe(32)
    invitation = {'invite_id': uuid4().hex, 'protocol_id': protocol_id, 'name': name,
                  'role': 'author', 'created_at': datetime.now(timezone.utc).isoformat()}
    db.invites.insert_one({'_id': hashlib.sha256(token.encode()).hexdigest(), **invitation})
    return {**invitation, 'token': token}
