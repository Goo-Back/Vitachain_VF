"""FAR-06 — nightly ad expiry worker: unit tests for sweep logic and heartbeat."""
from __future__ import annotations

import asyncio
import os
from unittest import mock

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakePool:
    """Minimal asyncpg pool stub."""

    def __init__(self, *, rows_returned: int) -> None:
        self._rows = [{"id": f"fake-id-{i}"} for i in range(rows_returned)]
        self.fetch_calls: list[str] = []
        self.closed = False

    async def fetch(self, sql: str) -> list[dict]:
        self.fetch_calls.append(sql)
        return self._rows

    async def close(self) -> None:
        self.closed = True


# ---------------------------------------------------------------------------
# sweep_once
# ---------------------------------------------------------------------------

class TestSweepOnce:
    @pytest.mark.asyncio
    async def test_zero_rows_returns_zero(self) -> None:
        from app.workers.farmarket_expiry.sweeper import sweep_once

        pool = _FakePool(rows_returned=0)
        count = await sweep_once(pool)  # type: ignore[arg-type]
        assert count == 0
        assert len(pool.fetch_calls) == 1

    @pytest.mark.asyncio
    async def test_five_rows_returns_five(self) -> None:
        from app.workers.farmarket_expiry.sweeper import sweep_once

        pool = _FakePool(rows_returned=5)
        count = await sweep_once(pool)  # type: ignore[arg-type]
        assert count == 5

    @pytest.mark.asyncio
    async def test_sql_contains_expiry_predicate(self) -> None:
        """The sweep SQL must target ACTIVE rows past expires_at — pins the WHERE clause."""
        from app.workers.farmarket_expiry.sweeper import EXPIRY_SWEEP_SQL

        sql = EXPIRY_SWEEP_SQL.lower()
        assert "status" in sql and "active" in sql
        assert "expires_at < now()" in sql
        assert "expired" in sql

    @pytest.mark.asyncio
    async def test_db_error_propagates(self) -> None:
        from app.workers.farmarket_expiry.sweeper import sweep_once

        class _BrokenPool:
            async def fetch(self, sql: str) -> list:
                raise RuntimeError("connection refused")

        with pytest.raises(RuntimeError, match="connection refused"):
            await sweep_once(_BrokenPool())  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# _ping_heartbeat
# ---------------------------------------------------------------------------

class TestPingHeartbeat:
    @pytest.mark.asyncio
    async def test_no_ping_when_url_unset(self) -> None:
        from app.workers.farmarket_expiry.sweeper import _ping_heartbeat

        mock_client = mock.AsyncMock()
        os.environ.pop("HEALTHCHECKS_FAR_EXPIRY_PING_URL", None)
        await _ping_heartbeat(mock_client)
        mock_client.get.assert_not_called()

    @pytest.mark.asyncio
    async def test_ping_sent_when_url_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.workers.farmarket_expiry.sweeper import _ping_heartbeat

        monkeypatch.setenv("HEALTHCHECKS_FAR_EXPIRY_PING_URL", "https://hc.example.com/ping/abc")
        mock_client = mock.AsyncMock()
        await _ping_heartbeat(mock_client)
        mock_client.get.assert_called_once_with(
            "https://hc.example.com/ping/abc", timeout=5.0
        )

    @pytest.mark.asyncio
    async def test_ping_exception_is_suppressed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.workers.farmarket_expiry.sweeper import _ping_heartbeat

        monkeypatch.setenv("HEALTHCHECKS_FAR_EXPIRY_PING_URL", "https://hc.example.com/ping/abc")
        mock_client = mock.AsyncMock()
        mock_client.get.side_effect = Exception("network timeout")
        # Must not raise.
        await _ping_heartbeat(mock_client)


# ---------------------------------------------------------------------------
# run_sweeper — stop signal handling
# ---------------------------------------------------------------------------

class TestRunSweeperStops:
    @pytest.mark.asyncio
    async def test_stop_event_terminates_loop(self) -> None:
        """Setting stop_event causes run_sweeper to exit cleanly without a second sweep."""
        import asyncpg  # noqa: F401 — only imported to check monkeypatch path

        stop = asyncio.Event()
        sweep_count = 0

        async def _fake_sweep(pool):  # noqa: ANN001
            nonlocal sweep_count
            sweep_count += 1
            return 0

        async def _fake_create_pool(**kwargs):  # noqa: ANN001
            return _FakePool(rows_returned=0)

        with (
            mock.patch("asyncpg.create_pool", side_effect=_fake_create_pool),
            mock.patch(
                "app.workers.farmarket_expiry.sweeper.sweep_once",
                side_effect=_fake_sweep,
            ),
            mock.patch("app.workers.farmarket_expiry.sweeper._ping_heartbeat"),
        ):
            from app.workers.farmarket_expiry.sweeper import run_sweeper

            # Set stop immediately — the loop should run the boot pass then stop.
            stop.set()
            await run_sweeper(stop)

        # Boot-time pass fires once; the while loop exits immediately because
        # stop is already set.
        assert sweep_count == 1
