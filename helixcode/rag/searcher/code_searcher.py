"""代码搜索器 — 语义检索代码库。

结合向量相似度和关键词匹配，提供混合检索能力。
"""

from __future__ import annotations

from helixcode.core.interfaces.code_index import CodeSearcher
from helixcode.core.interfaces.llm import EmbeddingProvider
from helixcode.core.value_objects import SearchResult
from helixcode.rag.config import RAGConfig
from helixcode.rag.searcher.reranker import Reranker
from helixcode.rag.store.vector_store import VectorStore


class Searcher(CodeSearcher):
    """代码语义搜索引擎。

    实现了 CodeSearcher 协议，支持:
    - search(): 自然语言查询 → 语义搜索
    - search_by_symbol(): 按符号名精确搜索
    """

    def __init__(
        self,
        embedder: EmbeddingProvider,
        vector_store: VectorStore,
        config: RAGConfig | None = None,
    ) -> None:
        self._embedder = embedder
        self._vector_store = vector_store
        self._config = config or RAGConfig()
        self._reranker = Reranker(self._config)

    async def search(
        self,
        query: str,
        *,
        top_k: int = 20,
        min_score: float = 0.0,
    ) -> list[SearchResult]:
        """语义搜索：将查询文本嵌入后搜索向量库。"""
        query_vector = await self._embedder.embed_single(query)

        raw = await self._vector_store.search(
            query_vector,
            top_k=max(top_k, self._config.top_k),
            min_score=min_score or self._config.min_score,
        )

        # 关键词混合重排序
        if self._config.rerank_keyword_boost > 0:
            raw = self._reranker.rerank(query, raw)

        return [
            SearchResult(
                symbol_name=r.get('symbols', [''])[0] if r.get('symbols') else '',
                symbol_kind='',
                file_path=r.get('file_path', ''),
                start_line=r.get('start_line', 1),
                end_line=r.get('end_line', 1),
                relevance_score=round(min(r.get('score', 0.0), 1.0), 4),
                snippet=r.get('text', '')[:500],
            )
            for r in raw
            if r.get('score', 0.0) >= self._config.similarity_threshold
        ]

    async def search_by_symbol(
        self,
        symbol_name: str,
        *,
        kind: str | None = None,
    ) -> list[SearchResult]:
        """按符号名精确搜索。"""
        # 构造一个指向符号名的查询向量
        query_text = f'symbol:{symbol_name}'
        if kind:
            query_text += f' kind:{kind}'

        return await self.search(query_text, top_k=10, min_score=0.2)
