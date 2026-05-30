"""Repository for :class:`MemoryRecord` entities."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from helixcode.storage.base_repository import BaseRepository
from helixcode.storage.models import MemoryRecord


class MemoryRecordRepository(BaseRepository[MemoryRecord]):
    """Concrete repository for memory entries (repository and long-term)."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, MemoryRecord)

    async def search_by_category(self, category: str) -> list[MemoryRecord]:
        """Return all records in *category*."""
        stmt = (
            select(MemoryRecord)
            .where(MemoryRecord.category == category)
            .order_by(MemoryRecord.created_at.desc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def search_by_embedding_id(self, embedding_id: str) -> list[MemoryRecord]:
        """Return records linked to a specific embedding."""
        stmt = select(MemoryRecord).where(
            MemoryRecord.embedding_id == embedding_id
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())
