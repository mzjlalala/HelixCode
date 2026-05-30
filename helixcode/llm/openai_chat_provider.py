"""OpenAI ChatProvider implementation."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from openai import AsyncOpenAI, APIError, APITimeoutError, RateLimitError

from helixcode.config import LLMConfig
from helixcode.core.interfaces.llm import ChatProvider
from helixcode.core.exceptions import InfrastructureError, RateLimitExceededError


class OpenAIChatProvider(ChatProvider):
    """Chat completion provider using the OpenAI SDK (async)."""

    def __init__(self, client: AsyncOpenAI, config: LLMConfig) -> None:
        self._client = client
        self._config = config

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        full_messages = self._build_messages(messages, system)
        temp = temperature if temperature is not None else self._config.temperature
        tokens = max_tokens if max_tokens is not None else self._config.max_tokens

        for attempt in range(1, self._config.max_retries + 2):  # initial + retries
            try:
                response = await self._client.chat.completions.create(
                    model=self._config.chat_model,
                    messages=full_messages,
                    temperature=temp,
                    max_tokens=tokens,
                )
                return response.choices[0].message.content or ''

            except RateLimitError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise RateLimitExceededError(
                    f'Rate limit exceeded after {self._config.max_retries} retries.'
                ) from None

            except APITimeoutError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise InfrastructureError(
                    'LLM request timed out.',
                    detail=f'After {self._config.max_retries} retries.',
                ) from None

            except APIError as exc:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise InfrastructureError(
                    'LLM API error.', detail=str(exc)
                ) from exc

        # Should be unreachable
        raise InfrastructureError('Unexpected: exhausted retries without raising.')

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        full_messages = self._build_messages(messages, system)
        temp = temperature if temperature is not None else self._config.temperature
        tokens = max_tokens if max_tokens is not None else self._config.max_tokens

        for attempt in range(1, self._config.max_retries + 2):
            try:
                stream = await self._client.chat.completions.create(
                    model=self._config.chat_model,
                    messages=full_messages,
                    temperature=temp,
                    max_tokens=tokens,
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        yield delta.content
                return

            except RateLimitError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise RateLimitExceededError(
                    f'Rate limit exceeded after {self._config.max_retries} retries.'
                ) from None

            except APITimeoutError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise InfrastructureError(
                    'LLM streaming request timed out.'
                ) from None

            except APIError as exc:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(max(1, 2 ** attempt))
                    continue
                raise InfrastructureError(
                    'LLM API error during streaming.', detail=str(exc)
                ) from exc

    def _build_messages(
        self,
        messages: list[dict[str, str]],
        system: str | None,
    ) -> list[dict[str, str]]:
        if system:
            return [{'role': 'system', 'content': system}] + list(messages)
        return list(messages)
