"""Tests for the configuration system."""

from __future__ import annotations

import os
from unittest.mock import patch

from helixcode.config import LLMConfig, QdrantConfig, Settings, StorageConfig


class TestLLMConfig:
    """Tests for :class:`LLMConfig`."""

    def test_defaults(self) -> None:
        """Default values are sensible."""
        cfg = LLMConfig()
        assert cfg.api_key == ''
        assert cfg.base_url == 'https://api.openai.com/v1'
        assert cfg.chat_model == 'gpt-4o'
        assert cfg.embedding_model == 'text-embedding-3-small'
        assert cfg.max_tokens == 4096
        assert cfg.temperature == 0.7

    def test_env_override(self) -> None:
        """Environment variables prefixed with HELIX_ override defaults."""
        with patch.dict(
            os.environ,
            {
                'HELIX_API_KEY': 'env-key',
                'HELIX_CHAT_MODEL': 'gpt-4-turbo',
                'HELIX_MAX_TOKENS': '8192',
                'HELIX_TEMPERATURE': '0.3',
            },
        ):
            cfg = LLMConfig()
            assert cfg.api_key == 'env-key'
            assert cfg.chat_model == 'gpt-4-turbo'
            assert cfg.max_tokens == 8192
            assert cfg.temperature == 0.3


class TestStorageConfig:
    """Tests for :class:`StorageConfig`."""

    def test_defaults(self) -> None:
        """Default is an aiosqlite file URL."""
        cfg = StorageConfig()
        assert 'sqlite+aiosqlite:///' in cfg.database_url

    def test_env_override(self) -> None:
        with patch.dict(
            os.environ,
            {'HELIX_STORAGE_DATABASE_URL': 'sqlite+aiosqlite:///custom.db'},
        ):
            cfg = StorageConfig()
            assert cfg.database_url == 'sqlite+aiosqlite:///custom.db'


class TestQdrantConfig:
    """Tests for :class:`QdrantConfig`."""

    def test_defaults(self) -> None:
        cfg = QdrantConfig()
        assert cfg.url == 'http://localhost:6333'
        assert cfg.collection_name == 'helixcode_code'
        assert cfg.vector_size == 1536
        assert cfg.distance == 'Cosine'


class TestSettings:
    """Tests for the root :class:`Settings`."""

    def test_defaults(self) -> None:
        """Root settings aggregate all sub-configs with sensible defaults."""
        settings = Settings()
        assert isinstance(settings.llm, LLMConfig)
        assert isinstance(settings.storage, StorageConfig)
        assert isinstance(settings.qdrant, QdrantConfig)
        assert settings.log_level == 'INFO'

    def test_nested_env_override(self) -> None:
        """Nested config picks up environment variables."""
        with patch.dict(
            os.environ,
            {
                'HELIX_API_KEY': 'top-level-key',
                'HELIX_LOG_LEVEL': 'DEBUG',
            },
        ):
            settings = Settings()
            assert settings.llm.api_key == 'top-level-key'
            assert settings.log_level == 'DEBUG'

    def test_explicit_values(self, settings: Settings) -> None:
        """Fixture-provided settings match fixture values."""
        assert settings.llm.chat_model == 'gpt-4o'
        assert settings.log_level == 'DEBUG'
