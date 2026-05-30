"""RAG 模块专用配置。

包含向量搜索的参数、分块策略、相似度阈值等。
"""

from __future__ import annotations

from pydantic import BaseModel


class RAGConfig(BaseModel):
    """RAG 流水线的可调参数。"""

    chunk_size: int = 500
    """代码分块的最大行数，超过此行数的文件会被切分。"""

    chunk_overlap: int = 50
    """相邻块之间的重叠行数，用于保持上下文连贯。"""

    top_k: int = 20
    """语义搜索返回的最大结果数。"""

    min_score: float = 0.0
    """搜索结果的最低相关性分数阈值（0~1）。"""

    similarity_threshold: float = 0.5
    """向量相似度阈值，低于此值的候选结果会被过滤。"""

    rerank_keyword_boost: float = 0.15
    """关键词匹配的权重加成（混入向量分数的比例）。"""

    index_batch_size: int = 32
    """批量嵌入时每批处理的文本数量。"""

    excluded_dirs: list[str] = [
        '__pycache__',
        '.git',
        '.venv',
        'venv',
        'node_modules',
        '.tox',
        'dist',
        'build',
        '.egg-info',
    ]
    """索引时跳过的目录。"""

    supported_extensions: list[str] = [
        '.py', '.pyi',
    ]
    """需要索引的文件扩展名列表。"""
