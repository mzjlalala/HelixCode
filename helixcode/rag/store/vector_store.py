"""向量存储 — Qdrant 高级操作（创建集合、写入、搜索、删除）。"""

from __future__ import annotations

import uuid

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qdrant_models

from helixcode.config import QdrantConfig


class VectorStore:
    """Qdrant 向量存储的高级封装。

    负责集合的创建、向量写入、相似度搜索和删除操作。
    """

    def __init__(self, client: AsyncQdrantClient, config: QdrantConfig) -> None:
        self._client = client
        self._config = config

    async def ensure_collection(self) -> None:
        """确保集合存在，不存在则创建。"""
        exists = await self._client.collection_exists(
            self._config.collection_name
        )
        if not exists:
            await self._client.create_collection(
                collection_name=self._config.collection_name,
                vectors_config=qdrant_models.VectorParams(
                    size=self._config.vector_size,
                    distance=self._config.distance,
                ),
            )

    async def upsert(
        self,
        vectors: list[list[float]],
        payloads: list[dict],
        texts: list[str],
    ) -> None:
        """批量写入或更新向量及其元数据。"""
        await self.ensure_collection()

        points = [
            qdrant_models.PointStruct(
                id=uuid.uuid4().hex,
                vector=vec,
                payload={
                    **payloads[i],
                    'text': texts[i],
                },
            )
            for i, vec in enumerate(vectors)
        ]

        await self._client.upsert(
            collection_name=self._config.collection_name,
            points=points,
        )

    async def search(
        self,
        query_vector: list[float],
        *,
        top_k: int = 20,
        min_score: float = 0.0,
    ) -> list[dict]:
        """执行向量相似度搜索，返回结果列表。"""
        await self.ensure_collection()

        results = await self._client.search(
            collection_name=self._config.collection_name,
            query_vector=query_vector,
            limit=top_k,
            score_threshold=min_score,
            with_payload=True,
        )

        return [
            {
                'id': hit.id,
                'score': hit.score,
                **hit.payload,
            }
            for hit in results
        ]

    async def delete_by_filter(
        self, filter_condition: dict
    ) -> None:
        """根据过滤条件删除向量点。"""
        await self.ensure_collection()

        try:
            await self._client.delete(
                collection_name=self._config.collection_name,
                points_selector=qdrant_models.FilterSelector(
                    filter=qdrant_models.Filter(**filter_condition)
                ),
            )
        except Exception:
            pass  # Qdrant filter 解析失败时忽略
