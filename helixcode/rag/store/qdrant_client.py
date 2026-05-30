"""Qdrant 客户端封装 — 异步连接管理。"""

from __future__ import annotations

from qdrant_client import AsyncQdrantClient

from helixcode.config import QdrantConfig


def create_qdrant_client(config: QdrantConfig) -> AsyncQdrantClient:
    """根据配置创建异步 Qdrant 客户端。

    当 api_key 为空时，使用无认证模式（适合本地部署）。
    """
    if config.api_key:
        return AsyncQdrantClient(
            url=config.url,
            api_key=config.api_key,
        )
    return AsyncQdrantClient(url=config.url)
