"""Factory for creating a configured AsyncOpenAI client."""

from __future__ import annotations

from openai import AsyncOpenAI

from helixcode.config import LLMConfig


def create_openai_client(config: LLMConfig, *, api_key: str | None = None) -> AsyncOpenAI:
    """Return an :class:`~openai.AsyncOpenAI` instance wired from *config*.

    Args:
        config: LLM configuration.
        api_key: Override the API key. When omitted, *config.api_key* is used.
    """
    key = api_key if api_key is not None else config.api_key
    return AsyncOpenAI(
        api_key=key,
        base_url=config.base_url,
        timeout=config.request_timeout,
        max_retries=0,  # We handle retries ourselves in the provider
    )
