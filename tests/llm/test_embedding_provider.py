"""Tests for OpenAIEmbeddingProvider."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from openai import APIError, APITimeoutError

from helixcode.config import LLMConfig
from helixcode.llm.openai_embedding_provider import OpenAIEmbeddingProvider


@pytest.fixture
def config() -> LLMConfig:
    return LLMConfig(
        api_key='test-key',
        embedding_model='text-embedding-3-small',
        max_retries=2,
        request_timeout=30.0,
    )


@pytest.fixture
def mock_client():
    return AsyncMock()


class TestEmbed:
    @pytest.mark.asyncio
    async def test_returns_embeddings(self, config, mock_client) -> None:
        emb1 = MagicMock()
        emb1.embedding = [0.1, 0.2, 0.3]
        emb2 = MagicMock()
        emb2.embedding = [0.4, 0.5, 0.6]
        mock_client.embeddings.create = AsyncMock(
            return_value=MagicMock(data=[emb1, emb2])
        )
        provider = OpenAIEmbeddingProvider(mock_client, config)

        result = await provider.embed(['hello', 'world'])
        assert result == [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]

    @pytest.mark.asyncio
    async def test_empty_input(self, config, mock_client) -> None:
        provider = OpenAIEmbeddingProvider(mock_client, config)
        result = await provider.embed([])
        assert result == []

    @pytest.mark.asyncio
    async def test_embed_single(self, config, mock_client) -> None:
        emb = MagicMock()
        emb.embedding = [0.1, 0.2]
        mock_client.embeddings.create = AsyncMock(
            return_value=MagicMock(data=[emb])
        )
        provider = OpenAIEmbeddingProvider(mock_client, config)

        result = await provider.embed_single('hello')
        assert result == [0.1, 0.2]

    @pytest.mark.asyncio
    async def test_retries_on_timeout(self, config, mock_client) -> None:
        emb = MagicMock()
        emb.embedding = [0.0]
        mock_client.embeddings.create = AsyncMock(
            side_effect=[
                APITimeoutError(request=None),
                MagicMock(data=[emb]),
            ]
        )
        provider = OpenAIEmbeddingProvider(mock_client, config)

        result = await provider.embed(['text'])
        assert result == [[0.0]]
        assert mock_client.embeddings.create.call_count == 2
