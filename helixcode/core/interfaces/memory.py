"""Memory system contracts — three tiers of persistence for agent context."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class SessionMemory(Protocol):
    """Per-invocation, in-memory context store."""

    def add_message(self, role: str, content: str) -> None:
        """Append a conversation turn."""
        ...

    def get_conversation(self) -> list[dict[str, str]]:
        """Return the full conversation history."""
        ...

    def set_context(self, key: str, value: Any) -> None:
        """Store an arbitrary key-value pair for the session."""
        ...

    def get_context(self, key: str) -> Any | None:
        """Retrieve a previously stored value, or ``None``."""
        ...

    def clear(self) -> None:
        """Reset all session state."""
        ...


@runtime_checkable
class RepositoryMemory(Protocol):
    """Project-level knowledge persisted to SQLite."""

    async def remember(self, key: str, value: str, category: str = 'general') -> None:
        """Store a fact about the current repository."""
        ...

    async def recall(self, key: str) -> str | None:
        """Retrieve a fact by its key."""
        ...

    async def recall_category(self, category: str) -> list[dict[str, str]]:
        """Return all facts within *category*."""
        ...

    async def update_repository_info(self, project_root: Path) -> None:
        """Scan *project_root* and auto-populate repository-level facts."""
        ...


@runtime_checkable
class LongTermMemory(Protocol):
    """Cross-project, long-lived knowledge store."""

    async def record_lesson(
        self, lesson: str, *, tags: list[str] | None = None
    ) -> str:
        """Persist a lesson and return its id."""
        ...

    async def find_lessons(self, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
        """Search across lessons for those relevant to *query*."""
        ...

    async def forget(self, lesson_id: str) -> bool:
        """Delete a lesson by id."""
        ...
