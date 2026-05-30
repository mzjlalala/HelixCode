"""LLM contracts — ChatProvider and EmbeddingProvider protocols."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable


@runtime_checkable
class ChatProvider(Protocol):
    """Sends messages to a large language model and returns a response."""

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Send *messages* and return the model's text response.

        When *system* is provided it is prepended as a system message.
        """
        ...

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        """Same as :meth:`chat` but yields chunks as they arrive."""
        ...


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Generates dense vector embeddings for text inputs."""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return an embedding vector for each text in *texts*."""
        ...

    async def embed_single(self, text: str) -> list[float]:
        """Convenience wrapper that returns a single vector."""
        ...
