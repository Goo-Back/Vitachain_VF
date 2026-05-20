"""Async workers — long-running processes outside the FastAPI request cycle.

Each worker ships as its own runnable module (``python -m app.workers.<name>``)
and as its own Docker compose service. They share the FastAPI image but never
the request loop, so a worker stall cannot wedge the API.

Allow-listed under AUTH-05: anything under ``app.workers.*`` may call
``service_client()`` or open a service-role asyncpg connection, provided the
callsite carries an inline ``# JUSTIFICATION:`` comment.
"""
