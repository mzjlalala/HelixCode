"""Code indexing and search contracts."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

from helixcode.core.value_objects import SearchResult


@runtime_checkable
class CodeIndexer(Protocol):
    """Indexes a source tree into the vector store."""

    async def index_project(self, root: Path) -> int:
        """Walk *root*, parse every source file, and store embeddings.

        Returns:
            The number of symbols indexed.
        """
        ...

    async def reindex_file(self, file_path: Path) -> int:
        """Re-index a single file (e.g. after a change).

        Returns:
            The number of symbols indexed from this file.
        """
        ...


@runtime_checkable
class CodeSearcher(Protocol):
    """Searches indexed code using semantic (vector) similarity."""

    async def search(
        self,
        query: str,
        *,
        top_k: int = 20,
        min_score: float = 0.0,
    ) -> list[SearchResult]:
        """Return results ranked by relevance to *query*."""
        ...

    async def search_by_symbol(
        self,
        symbol_name: str,
        *,
        kind: str | None = None,
    ) -> list[SearchResult]:
        """Find all occurrences of *symbol_name*, optionally filtered by *kind*."""
        ...
