"""Tests for UnitOfWork transaction boundary."""

from __future__ import annotations

import pytest

from helixcode.storage.database import create_engine, create_session_factory
from helixcode.storage.models import Base, SessionRecord
from helixcode.storage.unit_of_work import UnitOfWork


@pytest.fixture
async def session_factory():
    from helixcode.config import StorageConfig
    eng = create_engine(StorageConfig(database_url='sqlite+aiosqlite:///:memory:'))
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = create_session_factory(eng)
    yield factory
    await eng.dispose()


class TestUnitOfWork:
    @pytest.mark.asyncio
    async def test_explicit_commit_persists(self, session_factory) -> None:
        async with session_factory() as session:
            async with UnitOfWork(session) as uow:
                record = SessionRecord(metadata_json='{"key": "value"}')
                session.add(record)
                await uow.commit()

            # Record should be persisted now
            fresh = await session.get(SessionRecord, record.id)
            assert fresh is not None
            assert fresh.metadata_json == '{"key": "value"}'

    @pytest.mark.asyncio
    async def test_rollback_on_exception(self, session_factory) -> None:
        record_id: str | None = None
        async with session_factory() as session:
            try:
                async with UnitOfWork(session) as uow:
                    record = SessionRecord()
                    session.add(record)
                    await session.flush()
                    record_id = record.id
                    raise RuntimeError('forced failure')
            except RuntimeError:
                pass

            # Record should NOT be persisted because of rollback
            if record_id:
                fresh = await session.get(SessionRecord, record_id)
                assert fresh is None

    @pytest.mark.asyncio
    async def test_no_commit_triggers_rollback(self, session_factory) -> None:
        record_id: str | None = None
        async with session_factory() as session:
            async with UnitOfWork(session) as uow:
                record = SessionRecord()
                session.add(record)
                await session.flush()
                record_id = record.id
                # No commit() call -> should rollback on exit

            if record_id:
                fresh = await session.get(SessionRecord, record_id)
                assert fresh is None

    @pytest.mark.asyncio
    async def test_explicit_rollback(self, session_factory) -> None:
        record_id: str | None = None
        async with session_factory() as session:
            async with UnitOfWork(session) as uow:
                record = SessionRecord()
                session.add(record)
                await session.flush()
                record_id = record.id
                await uow.rollback()

            if record_id:
                fresh = await session.get(SessionRecord, record_id)
                assert fresh is None
