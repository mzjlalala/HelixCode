"""Unit-of-work context manager for transaction boundaries."""

from __future__ import annotations

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession


class UnitOfWork:
    """Wraps an :class:`AsyncSession` in an explicit transaction.

    Usage::

        async with UnitOfWork(session) as uow:
            await repo.add(entity)
            await uow.commit()  # explicit commit
        # rollback on exception or if commit() not called
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._committed = False

    async def __aenter__(self) -> UnitOfWork:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        if exc_type is not None:
            await self._session.rollback()
        elif not self._committed:
            await self._session.rollback()

    async def commit(self) -> None:
        """Commit the current transaction."""
        await self._session.commit()
        self._committed = True

    async def rollback(self) -> None:
        """Explicitly roll back the current transaction."""
        await self._session.rollback()
        self._committed = False
