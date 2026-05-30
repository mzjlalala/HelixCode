"""Token-bucket rate limiter for API calls."""

from __future__ import annotations

import asyncio
import time


class RateLimiter:
    """Asynchronous token-bucket rate limiter.

    Usage::

        limiter = RateLimiter(rate=10.0)  # 10 requests per second
        async with limiter:
            await make_api_call()

    Args:
        rate: Maximum sustained requests per second.
        burst: Maximum burst size (tokens that can be consumed instantly).
    """

    def __init__(self, rate: float = 10.0, burst: int | None = None) -> None:
        if rate <= 0:
            raise ValueError('Rate must be positive')
        self._rate = rate
        self._burst = burst if burst is not None else max(1, int(rate))
        self._tokens = float(self._burst)
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    @property
    def rate(self) -> float:
        return self._rate

    @property
    def available_tokens(self) -> float:
        """Return the current token count, including refill from elapsed time."""
        self._refill()
        return self._tokens

    async def acquire(self) -> None:
        """Block until at least one token is available, then consume it."""
        async with self._lock:
            self._refill()
            if self._tokens >= 1.0:
                self._tokens -= 1.0
                return

        # Wait for enough time to pass for one token
        wait_time = (1.0 - self._tokens) / self._rate
        await asyncio.sleep(wait_time)

        async with self._lock:
            self._refill()
            self._tokens -= 1.0

    async def __aenter__(self) -> RateLimiter:
        await self.acquire()
        return self

    async def __aexit__(self, *args) -> None:
        pass

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(float(self._burst), self._tokens + elapsed * self._rate)
        self._last_refill = now
