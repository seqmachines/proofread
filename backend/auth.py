"""Resolve review tokens to server-owned reviewer identities."""

import hashlib
import os
import secrets

from fastapi import HTTPException


def reviewer_for_token(token):
    for entry in os.getenv('REVIEW_TOKENS', '').split(','):
        parts = entry.strip().split(':', 2)
        if len(parts) != 3:
            continue
        expected, name, role = parts
        if expected and name and role in {'curator', 'author'} and token and secrets.compare_digest(token, expected):
            return {'id': hashlib.sha256(expected.encode()).hexdigest()[:24], 'name': name, 'role': role}
    raise HTTPException(status_code=401, detail='A valid X-Review-Token is required')


def requires_review_token(method, path):
    if method != 'POST':
        return False
    return (path == '/import' or path.startswith('/harness/') or
            (path.startswith('/runs/') and (path.endswith('/reviews') or path.endswith('/messages')
             or ('/patches/' in path and path.endswith('/apply')))))
