"""OpenAI EmbeddingProvider implementation."""

from __future__ import annotations

import asyncio

from openai import AsyncOpenAI, APIError, APITimeoutError

from helixcode.config import LLMConfig
from helixcode.core.exceptions import InfrastructureError
from helixcode.core.interfaces.llm import EmbeddingProvider


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """Embedding provider using the OpenAI SDK (async)."""

    def __init__(self, client: AsyncOpenAI, config: LLMConfig) -> None:
        self._client = client
        self._config = config

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return an embedding vector for each text in *texts*."""
        if not texts:
            return []

        for attempt in range(1, self._config.max_retries + 2):
            try:
                response = await self._client.embeddings.create(
                    model=self._config.embedding_model,
                    input=texts,
                )
                return [d.embedding for d in response.data]

            except APITimeoutError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise InfrastructureError(
                    'Embedding request timed out.'
                ) from None

            except APIError as exc:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise InfrastructureError(
                    'Embedding API error.', detail=str(exc)
                ) from exc

        raise InfrastructureError('Unexpected: exhausted retries without raising.')

    async def embed_single(self, text: str) -> list[float]:
        """Convenience: return a single embedding vector."""
        results = await self.embed([text])
        return results[0]
