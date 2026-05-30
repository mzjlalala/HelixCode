"""Generic Repository[T] implementation backed by SQLAlchemy async."""

from __future__ import annotations

from typing import Generic, TypeVar

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from helixcode.core.interfaces.storage import Repository

T = TypeVar('T')


class BaseRepository(Repository[T], Generic[T]):
    """SQLAlchemy-based async repository for entity type *T*."""

    def __init__(self, session: AsyncSession, model_class: type[T]) -> None:
        self._session = session
        self._model = model_class

    async def add(self, entity: T) -> T:
        self._session.add(entity)
        await self._session.flush()
        return entity

    async def get(self, entity_id: str) -> T | None:
        return await self._session.get(self._model, entity_id)

    async def list(self, *, limit: int = 100, offset: int = 0) -> list[T]:
        stmt = select(self._model).limit(limit).offset(offset)
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def update(self, entity: T) -> T:
        merged = await self._session.merge(entity)
        await self._session.flush()
        return merged

    async def delete(self, entity_id: str) -> bool:
        entity = await self.get(entity_id)
        if entity is None:
            return False
        await self._session.delete(entity)
        await self._session.flush()
        return True

    async def count(self) -> int:
        stmt = select(func.count()).select_from(self._model)
        result = await self._session.execute(stmt)
        return result.scalar_one()
