"""Repository for :class:`SessionRecord` entities."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from helixcode.storage.base_repository import BaseRepository
from helixcode.storage.models import SessionRecord


class SessionRepository(BaseRepository[SessionRecord]):
    """Concrete repository for conversation session records."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, SessionRecord)

    async def get_recent(self, limit: int = 10) -> list[SessionRecord]:
        """Return the *limit* most recently updated sessions."""
        stmt = (
            select(SessionRecord)
            .order_by(SessionRecord.updated_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())
