"""Shared test fixtures and helpers."""

from __future__ import annotations

import pytest

from helixcode.config import LLMConfig, QdrantConfig, Settings, StorageConfig


@pytest.fixture
def llm_config() -> LLMConfig:
    """Return a fully-populated LLMConfig for tests."""
    return LLMConfig(
        api_key='test-key',
        base_url='https://test-api.example.com/v1',
        chat_model='gpt-4o',
        embedding_model='text-embedding-3-small',
        max_tokens=4096,
        temperature=0.7,
        max_retries=1,
        request_timeout=30.0,
    )


@pytest.fixture
def storage_config() -> StorageConfig:
    """Return an in-memory SQLite StorageConfig for tests."""
    return StorageConfig(database_url='sqlite+aiosqlite:///:memory:')


@pytest.fixture
def qdrant_config() -> QdrantConfig:
    """Return a local QdrantConfig for tests."""
    return QdrantConfig(
        url='http://localhost:6333',
        collection_name='helixcode_test',
        vector_size=1536,
        distance='Cosine',
    )


@pytest.fixture
def settings(llm_config, storage_config, qdrant_config) -> Settings:
    """Return a Settings instance suitable for unit tests."""
    return Settings(
        llm=llm_config,
        storage=storage_config,
        qdrant=qdrant_config,
        log_level='DEBUG',
        project_root='.',
    )
