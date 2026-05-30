"""Persistence contracts — generic repository and unit-of-work interfaces."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Generic, TypeVar

T = TypeVar('T')
ID = TypeVar('ID', str, int)


class Repository(ABC, Generic[T]):
    """Generic repository interface (Repository pattern).

    Concrete implementations in the ``storage/`` package adapt this
    to SQLAlchemy + aiosqlite.
    """

    @abstractmethod
    async def add(self, entity: T) -> T:
        """Persist *entity* and return it (now with an identity)."""
        ...

    @abstractmethod
    async def get(self, entity_id: str) -> T | None:
        """Retrieve an entity by its unique id, or ``None``."""
        ...

    @abstractmethod
    async def list(
        self, *, limit: int = 100, offset: int = 0
    ) -> list[T]:
        """Return a page of entities."""
        ...

    @abstractmethod
    async def update(self, entity: T) -> T:
        """Persist changes to an already-tracked *entity*."""
        ...

    @abstractmethod
    async def delete(self, entity_id: str) -> bool:
        """Remove the entity identified by *entity_id*. Return ``True`` on success."""
        ...

    @abstractmethod
    async def count(self) -> int:
        """Return the total number of entities."""
        ...
