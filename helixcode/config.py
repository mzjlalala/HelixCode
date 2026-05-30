from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMConfig(BaseSettings):
    """Configuration for the LLM provider (OpenAI-compatible API)."""

    model_config = SettingsConfigDict(env_prefix='HELIX_LLM_')

    api_key: str = ''
    base_url: str = 'https://api.openai.com/v1'
    chat_model: str = 'gpt-4o'
    embedding_model: str = 'text-embedding-3-small'
    max_tokens: int = 4096
    temperature: float = 0.7
    max_retries: int = 3
    request_timeout: float = 120.0


class StorageConfig(BaseSettings):
    """Configuration for SQLite storage."""

    model_config = SettingsConfigDict(env_prefix='HELIX_STORAGE_')

    database_url: str = 'sqlite+aiosqlite:///helixcode.db'


class QdrantConfig(BaseSettings):
    """Configuration for Qdrant vector database."""

    model_config = SettingsConfigDict(env_prefix='HELIX_QDRANT_')

    url: str = 'http://localhost:6333'
    api_key: str = ''
    collection_name: str = 'helixcode_code'
    vector_size: int = 1536  # text-embedding-3-small
    distance: str = 'Cosine'


class Settings(BaseSettings):
    """Root configuration aggregating all subsystem configs."""

    model_config = SettingsConfigDict(env_file='.env', env_prefix='HELIX_')

    llm: LLMConfig = Field(default_factory=LLMConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    qdrant: QdrantConfig = Field(default_factory=QdrantConfig)
    log_level: str = 'INFO'
    project_root: str = '.'
