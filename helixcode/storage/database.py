"""Async SQLAlchemy engine and session lifecycle."""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from helixcode.config import StorageConfig


def create_engine(config: StorageConfig) -> AsyncEngine:
    """Build an async SQLAlchemy engine from *config*.

    Enables WAL journal mode and foreign key enforcement for SQLite.
    """
    connect_args: dict[str, str | bool] = {
        'check_same_thread': False,
    }
    engine = create_async_engine(
        config.database_url,
        echo=False,
        connect_args=connect_args,
    )

    @event.listens_for(engine.sync_engine, 'connect')
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        """Enable WAL mode and foreign key enforcement on every connection."""
        cursor = dbapi_connection.cursor()
        cursor.execute('PRAGMA journal_mode=WAL')
        cursor.execute('PRAGMA foreign_keys=ON')
        cursor.close()

    return engine


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Return a sessionmaker bound to *engine*.

    Sessions expire_on_commit=False so entities can be read after commit
    without an explicit refresh (important for async flows).
    """
    return async_sessionmaker(engine, expire_on_commit=False)
