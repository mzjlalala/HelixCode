"""代码索引编排器 — 协调解析 → 分块 → 嵌入 → 存储的全流程。"""

from __future__ import annotations

from pathlib import Path

from helixcode.core.interfaces.llm import EmbeddingProvider
from helixcode.rag.config import RAGConfig
from helixcode.rag.indexer.chunker import CodeChunker
from helixcode.rag.indexer.code_parser import CodeParser
from helixcode.rag.store.vector_store import VectorStore
from helixcode.tools.file_utils import find_files


class CodeIndexer:
    """编排代码索引流水线的核心类。

    用法::

        indexer = CodeIndexer(embedder, vector_store)
        count = await indexer.index_project(Path('/path/to/project'))
    """

    def __init__(
        self,
        embedder: EmbeddingProvider,
        vector_store: VectorStore,
        config: RAGConfig | None = None,
    ) -> None:
        self._config = config or RAGConfig()
        self._embedder = embedder
        self._vector_store = vector_store
        self._parser = CodeParser(self._config)
        self._chunker = CodeChunker(self._config)

    async def index_project(self, root: Path) -> int:
        """索引整个项目目录。

        流程：发现文件 → 解析符号 → 分块 → 嵌入 → 写入 Qdrant

        Returns:
            成功索引的代码块数量。
        """
        files = find_files(
            root,
            pattern='*',
            exclude_dirs=self._config.excluded_dirs,
        )

        total_chunks = 0
        batch_texts: list[str] = []
        batch_chunks: list[dict] = []

        for file_path in files:
            if not self._parser.should_index(file_path, self._config):
                continue

            try:
                symbols = self._parser.parse_file(file_path)
            except Exception:
                continue  # 跳过解析失败的文件

            content = file_path.read_text(encoding='utf-8', errors='replace')
            chunks = self._chunker.chunk_file(
                str(file_path), content, symbols
            )

            for chunk in chunks:
                batch_texts.append(chunk.content)
                batch_chunks.append({
                    'file_path': str(file_path),
                    'start_line': chunk.start_line,
                    'end_line': chunk.end_line,
                    'symbols': chunk.symbols,
                })

                # 达到批次大小时写入
                if len(batch_texts) >= self._config.index_batch_size:
                    await self._embed_and_store(batch_texts, batch_chunks)
                    total_chunks += len(batch_texts)
                    batch_texts.clear()
                    batch_chunks.clear()

        # 处理剩余批次
        if batch_texts:
            await self._embed_and_store(batch_texts, batch_chunks)
            total_chunks += len(batch_texts)

        return total_chunks

    async def reindex_file(self, file_path: Path) -> int:
        """重新索引单个文件（文件变更后调用）。"""
        if not file_path.exists():
            # 文件已删除，从向量库中移除
            await self._vector_store.delete_by_filter(
                filter_condition={'must': [{'key': 'file_path', 'match': {'value': str(file_path)}}]}
            )
            return 0

        symbols = self._parser.parse_file(file_path)
        content = file_path.read_text(encoding='utf-8', errors='replace')
        chunks = self._chunker.chunk_file(str(file_path), content, symbols)

        texts = [c.content for c in chunks]
        metadatas = [{
            'file_path': str(file_path),
            'start_line': c.start_line,
            'end_line': c.end_line,
            'symbols': c.symbols,
        } for c in chunks]

        if texts:
            await self._embed_and_store(texts, metadatas)

        return len(texts)

    async def _embed_and_store(
        self, texts: list[str], metadatas: list[dict]
    ) -> None:
        """将文本嵌入并存储到向量库。"""
        embeddings = await self._embedder.embed(texts)
        await self._vector_store.upsert(embeddings, metadatas, texts)
