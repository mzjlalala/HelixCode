"""代码嵌入器 — 使用 OpenAI Embedding API 生成代码块的向量表示。"""

from __future__ import annotations

from helixcode.core.interfaces.llm import EmbeddingProvider


class CodeEmbedder:
    """为代码块生成向量嵌入的薄封装。

    将 EmbeddingProvider 接口适配到 RAG 模块的具体用法。
    """

    def __init__(self, provider: EmbeddingProvider) -> None:
        self._provider = provider

    async def embed_chunks(self, texts: list[str]) -> list[list[float]]:
        """为一批代码块文本生成向量。"""
        if not texts:
            return []
        return await self._provider.embed(texts)

    async def embed_query(self, query: str) -> list[float]:
        """为搜索查询生成单个向量。"""
        return await self._provider.embed_single(query)
