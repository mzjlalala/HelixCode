"""Tests for repository implementations."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from helixcode.storage.base_repository import BaseRepository
from helixcode.storage.database import create_engine, create_session_factory
from helixcode.storage.models import Base, MemoryRecord, SessionRecord
from helixcode.storage.memory_repository import MemoryRecordRepository
from helixcode.storage.session_repository import SessionRepository


@pytest.fixture
async def engine():
    """In-memory SQLite engine with schema created."""
    from helixcode.config import StorageConfig
    eng = create_engine(StorageConfig(database_url='sqlite+aiosqlite:///:memory:'))
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session_factory(engine):
    return create_session_factory(engine)


@pytest.fixture
async def session(session_factory):
    async with session_factory() as sess:
        yield sess


class TestBaseRepository:
    """Tests for the generic BaseRepository[T]."""

    @pytest.mark.asyncio
    async def test_add_and_get(self, session: AsyncSession) -> None:
        repo: BaseRepository[SessionRecord] = BaseRepository(session, SessionRecord)
        record = SessionRecord()
        added = await repo.add(record)
        assert added.id is not None

        fetched = await repo.get(added.id)
        assert fetched is not None
        assert fetched.id == added.id

    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, session: AsyncSession) -> None:
        repo: BaseRepository[SessionRecord] = BaseRepository(session, SessionRecord)
        assert await repo.get('nonexistent') is None

    @pytest.mark.asyncio
    async def test_count_starts_at_zero(self, session: AsyncSession) -> None:
        repo: BaseRepository[SessionRecord] = BaseRepository(session, SessionRecord)
        assert await repo.count() == 0

    @pytest.mark.asyncio
    async def test_list_pagination(self, session: AsyncSession) -> None:
        repo: BaseRepository[SessionRecord] = BaseRepository(session, SessionRecord)
        for _ in range(5):
            await repo.add(SessionRecord())

        page = await repo.list(limit=3, offset=1)
        assert len(page) == 3

    @pytest.mark.asyncio
    async def test_update(self, session: AsyncSession) -> None:
        repo: BaseRepository[SessionRecord] = BaseRepository(session, SessionRecord)
        record = await repo.add(SessionRecord(metadata_json='{"a": 1}'))

        record.metadata_json = '{"a": 2}'
        await repo.update(record)

        fetched = await repo.get(record.id)
        assert fetched is not None
        assert fetched.metadata_json == '{"a": 2}'

    @pytest.mark.asyncio
    async def test_delete(self, session: AsyncSession) -> None:
        repo: BaseRepository[SessionRecord] = BaseRepository(session, SessionRecord)
        record = await repo.add(SessionRecord())

        assert await repo.delete(record.id) is True
        assert await repo.get(record.id) is None

    @pytest.mark.asyncio
    async def test_delete_missing(self, session: AsyncSession) -> None:
        repo: BaseRepository[SessionRecord] = BaseRepository(session, SessionRecord)
        assert await repo.delete('nonexistent') is False


class TestSessionRepository:
    @pytest.mark.asyncio
    async def test_get_recent(self, session: AsyncSession) -> None:
        repo = SessionRepository(session)
        for _ in range(5):
            await repo.add(SessionRecord())
        recent = await repo.get_recent(limit=3)
        assert len(recent) == 3

    @pytest.mark.asyncio
    async def test_get_recent_limited_by_available(self, session: AsyncSession) -> None:
        repo = SessionRepository(session)
        await repo.add(SessionRecord())
        recent = await repo.get_recent(limit=10)
        assert len(recent) == 1


class TestMemoryRecordRepository:
    @pytest.mark.asyncio
    async def test_search_by_category(self, session: AsyncSession) -> None:
        repo = MemoryRecordRepository(session)
        await repo.add(MemoryRecord(content='a', category='tools'))
        await repo.add(MemoryRecord(content='b', category='tools'))
        await repo.add(MemoryRecord(content='c', category='db'))

        tools = await repo.search_by_category('tools')
        assert len(tools) == 2

        db = await repo.search_by_category('db')
        assert len(db) == 1

    @pytest.mark.asyncio
    async def test_search_by_embedding_id(self, session: AsyncSession) -> None:
        repo = MemoryRecordRepository(session)
        await repo.add(MemoryRecord(content='x', embedding_id='emb-1'))
        await repo.add(MemoryRecord(content='y'))

        results = await repo.search_by_embedding_id('emb-1')
        assert len(results) == 1
        assert results[0].content == 'x'
