"""RAG 流水线 — 索引和搜索的统一入口。

提供 CodeIndexer 和 CodeSearcher 协议的完整实现。
"""

from __future__ import annotations

from pathlib import Path

from helixcode.core.interfaces.code_index import CodeIndexer, CodeSearcher
from helixcode.core.interfaces.llm import EmbeddingProvider
from helixcode.core.value_objects import SearchResult
from helixcode.rag.config import RAGConfig
from helixcode.rag.indexer.code_indexer import CodeIndexer as IndexerImpl
from helixcode.rag.searcher.code_searcher import Searcher
from helixcode.rag.store.vector_store import VectorStore


class RAGPipeline(CodeIndexer, CodeSearcher):
    """RAG 流水线统一入口，同时实现索引和搜索两个协议。

    Usage::

        pipeline = RAGPipeline(embedder, vector_store)
        await pipeline.index_project(Path('/project'))
        results = await pipeline.search('订单超时处理')
    """

    def __init__(
        self,
        embedder: EmbeddingProvider,
        vector_store: VectorStore,
        config: RAGConfig | None = None,
    ) -> None:
        self._config = config or RAGConfig()
        self._indexer = IndexerImpl(embedder, vector_store, self._config)
        self._searcher = Searcher(embedder, vector_store, self._config)

    # -- CodeIndexer 协议 --

    async def index_project(self, root: Path) -> int:
        return await self._indexer.index_project(root)

    async def reindex_file(self, file_path: Path) -> int:
        return await self._indexer.reindex_file(file_path)

    # -- CodeSearcher 协议 --

    async def search(
        self,
        query: str,
        *,
        top_k: int = 20,
        min_score: float = 0.0,
    ) -> list[SearchResult]:
        return await self._searcher.search(
            query, top_k=top_k, min_score=min_score
        )

    async def search_by_symbol(
        self,
        symbol_name: str,
        *,
        kind: str | None = None,
    ) -> list[SearchResult]:
        return await self._searcher.search_by_symbol(
            symbol_name, kind=kind
        )
