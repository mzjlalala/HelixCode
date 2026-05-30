"""Tests for OpenAIChatProvider."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from openai import APIError, APITimeoutError, RateLimitError

from helixcode.config import LLMConfig
from helixcode.llm.openai_chat_provider import OpenAIChatProvider


def _make_rate_limit_error(message: str) -> RateLimitError:
    """Build a RateLimitError with mock response/request for testing."""
    request = MagicMock()
    response = MagicMock()
    response.request = request
    return RateLimitError(message, response=response, body=None)


@pytest.fixture
def config() -> LLMConfig:
    return LLMConfig(
        api_key='test-key',
        base_url='https://api.test.example/v1',
        chat_model='gpt-4o',
        max_tokens=100,
        temperature=0.5,
        max_retries=2,
        request_timeout=30.0,
    )


@pytest.fixture
def mock_client():
    return AsyncMock()


class TestChat:
    @pytest.mark.asyncio
    async def test_returns_content(self, config, mock_client) -> None:
        choice = MagicMock()
        choice.message.content = 'Hello, world!'
        mock_client.chat.completions.create = AsyncMock(
            return_value=MagicMock(choices=[choice])
        )
        provider = OpenAIChatProvider(mock_client, config)

        result = await provider.chat([{'role': 'user', 'content': 'Hi'}])
        assert result == 'Hello, world!'

    @pytest.mark.asyncio
    async def test_includes_system_message(self, config, mock_client) -> None:
        """System prompt is prepended as a system-role message."""
        choice = MagicMock()
        choice.message.content = 'ok'
        mock_client.chat.completions.create = AsyncMock(
            return_value=MagicMock(choices=[choice])
        )
        provider = OpenAIChatProvider(mock_client, config)

        await provider.chat(
            [{'role': 'user', 'content': 'Hi'}],
            system='You are helpful.',
        )
        call_args = mock_client.chat.completions.create.call_args
        messages = call_args[1]['messages']
        assert messages[0] == {'role': 'system', 'content': 'You are helpful.'}

    @pytest.mark.asyncio
    async def test_uses_default_temperature(self, config, mock_client) -> None:
        choice = MagicMock()
        choice.message.content = 'ok'
        mock_client.chat.completions.create = AsyncMock(
            return_value=MagicMock(choices=[choice])
        )
        provider = OpenAIChatProvider(mock_client, config)

        await provider.chat([{'role': 'user', 'content': 'Hi'}])
        call_args = mock_client.chat.completions.create.call_args
        assert call_args[1]['temperature'] == 0.5

    @pytest.mark.asyncio
    async def test_retries_on_rate_limit(self, config, mock_client) -> None:
        choice = MagicMock()
        choice.message.content = 'success'
        mock_client.chat.completions.create = AsyncMock(
            side_effect=[
                _make_rate_limit_error('slow down'),
                MagicMock(choices=[choice]),
            ]
        )
        provider = OpenAIChatProvider(mock_client, config)

        result = await provider.chat([{'role': 'user', 'content': 'Hi'}])
        assert result == 'success'
        assert mock_client.chat.completions.create.call_count == 2

    @pytest.mark.asyncio
    async def test_raises_after_max_retries(self, config, mock_client) -> None:
        mock_client.chat.completions.create = AsyncMock(
            side_effect=_make_rate_limit_error('nope')
        )
        provider = OpenAIChatProvider(mock_client, config)

        with pytest.raises(Exception):
            await provider.chat([{'role': 'user', 'content': 'Hi'}])

        # Initial attempt + max_retries (2) = 3 total calls
        assert mock_client.chat.completions.create.call_count == 3


class TestChatStream:
    @pytest.mark.asyncio
    async def test_yields_chunks(self, config, mock_client) -> None:
        chunks = []
        for text in ['Hello', ', ', 'world!']:
            delta = MagicMock()
            delta.content = text
            chunk = MagicMock()
            chunk.choices = [MagicMock(delta=delta)]
            chunks.append(chunk)

        async def _stream():
            for c in chunks:
                yield c

        mock_client.chat.completions.create = AsyncMock(return_value=_stream())
        provider = OpenAIChatProvider(mock_client, config)

        received: list[str] = []
        async for token in provider.chat_stream([{'role': 'user', 'content': 'Hi'}]):
            received.append(token)

        assert ''.join(received) == 'Hello, world!'
