"""SQLAlchemy ORM models for session and memory records."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    """SQLAlchemy declarative base for all HelixCode ORM models."""


class SessionRecord(Base):
    """A conversation session stored for history and resumption."""

    __tablename__ = 'sessions'

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    metadata_json: Mapped[str] = mapped_column(Text, default='{}')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow
    )

    def __repr__(self) -> str:
        return f'<SessionRecord id={self.id!r} created={self.created_at!r}>'


class MemoryRecord(Base):
    """A long-term or repository-level memory entry."""

    __tablename__ = 'memories'

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(64), default='general', index=True)
    embedding_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, default='{}')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    def __repr__(self) -> str:
        return f'<MemoryRecord id={self.id!r} category={self.category!r}>'
