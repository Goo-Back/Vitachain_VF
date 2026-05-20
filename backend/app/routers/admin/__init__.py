"""Admin routers.

This package is the canonical home of admin endpoints. AUTH-05's AST allow-list
(``backend/tests/test_service_client_callsite_allowlist.py``) pins
``routers/admin/`` as a permitted ``service_client()`` call site — moving an
admin handler out of this directory will fail that test.
"""
