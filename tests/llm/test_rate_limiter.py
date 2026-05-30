"""Tests for the token-bucket RateLimiter."""

from __future__ import annotations

import asyncio
import time

import pytest

from helixcode.llm.rate_limiter import RateLimiter


class TestRateLimiter:
    def test_invalid_rate_raises(self) -> None:
        with pytest.raises(ValueError):
            RateLimiter(rate=0)

    def test_initial_tokens_equals_burst(self) -> None:
        limiter = RateLimiter(rate=5.0, burst=10)
        assert limiter.available_tokens == 10.0

    @pytest.mark.asyncio
    async def test_acquire_consumes_token(self) -> None:
        limiter = RateLimiter(rate=10.0, burst=5)
        await limiter.acquire()
        assert 4.0 <= limiter.available_tokens <= 5.0  # near 4 depending on timing

    @pytest.mark.asyncio
    async def test_async_context_manager(self) -> None:
        limiter = RateLimiter(rate=10.0, burst=5)
        before = limiter.available_tokens
        async with limiter:
            pass
        assert limiter.available_tokens < before  # one token consumed

    @pytest.mark.asyncio
    async def test_refill_over_time(self) -> None:
        """Tokens should refill as time passes."""
        limiter = RateLimiter(rate=100.0, burst=10)
        # Drain tokens
        for _ in range(10):
            await limiter.acquire()

        assert limiter.available_tokens < 1.0

        # Wait for refill
        await asyncio.sleep(0.1)

        # At 100 tokens/sec, we should have ~10 tokens after 0.1s
        assert limiter.available_tokens > 5.0

    @pytest.mark.asyncio
    async def test_tokens_capped_at_burst(self) -> None:
        limiter = RateLimiter(rate=100.0, burst=3)
        # Drain all tokens
        for _ in range(3):
            await limiter.acquire()

        # Wait plenty of time
        await asyncio.sleep(0.2)

        # Should be capped at burst=3, not 20
        assert limiter.available_tokens <= 3.0
