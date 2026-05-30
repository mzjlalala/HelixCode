"""RAGConfig 的测试。"""

from __future__ import annotations

from helixcode.rag.config import RAGConfig


class TestRAGConfig:
    def test_defaults(self) -> None:
        config = RAGConfig()
        assert config.chunk_size == 500
        assert config.top_k == 20
        assert config.rerank_keyword_boost == 0.15
        assert '__pycache__' in config.excluded_dirs
        assert '.git' in config.excluded_dirs

    def test_custom_values(self) -> None:
        config = RAGConfig(
            chunk_size=300,
            top_k=10,
            rerank_keyword_boost=0.2,
        )
        assert config.chunk_size == 300
        assert config.top_k == 10
