"""Tests for the database engine and session factory."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from helixcode.config import StorageConfig
from helixcode.storage.database import create_engine, create_session_factory


class TestCreateEngine:
    def test_returns_async_engine(self) -> None:
        config = StorageConfig(database_url='sqlite+aiosqlite:///:memory:')
        engine = create_engine(config)
        assert isinstance(engine, AsyncEngine)

    def test_custom_url(self) -> None:
        config = StorageConfig(database_url='sqlite+aiosqlite:///test.db')
        engine = create_engine(config)
        assert str(engine.url) == 'sqlite+aiosqlite:///test.db'


class TestSessionFactory:
    @pytest.mark.asyncio
    async def test_can_execute_query(self) -> None:
        config = StorageConfig(database_url='sqlite+aiosqlite:///:memory:')
        engine = create_engine(config)
        factory = create_session_factory(engine)
        async with factory() as session:
            result = await session.execute(text('SELECT 1'))
            assert result.scalar_one() == 1

    @pytest.mark.asyncio
    async def test_foreign_keys_enabled(self) -> None:
        config = StorageConfig(database_url='sqlite+aiosqlite:///:memory:')
        engine = create_engine(config)
        factory = create_session_factory(engine)
        async with factory() as session:
            result = await session.execute(text('PRAGMA foreign_keys'))
            assert result.scalar_one() == 1
