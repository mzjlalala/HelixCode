"""长期记忆 — 跨项目持久化记忆。

存储跨项目的经验教训、成功的修复模式、代码审查模式、用户偏好等。
数据持久化到 SQLite，支持按标签检索。
"""

from __future__ import annotations

from typing import Any

from helixcode.core.interfaces.memory import LongTermMemory
from helixcode.storage.memory_repository import MemoryRecordRepository


class LongTermStore(LongTermMemory):
    """长期记忆存储，跨项目复用。

    典型用法：
    - 记录修复某个 bug 的成功方案
    - 存储用户偏好的代码风格
    - 积累代码审查中常见的问题模式
    """

    def __init__(self, repo: MemoryRecordRepository) -> None:
        self._repo = repo
        self._category = 'long_term'

    async def record_lesson(
        self, lesson: str, *, tags: list[str] | None = None
    ) -> str:
        """记录一条经验教训。

        Args:
            lesson: 经验内容
            tags: 便于检索的标签列表

        Returns:
            新记录的 ID。
        """
        from helixcode.storage.models import MemoryRecord
        record = MemoryRecord(
            content=lesson,
            category=self._category,
            metadata_json=str(tags or []),
        )
        saved = await self._repo.add(record)
        return saved.id

    async def find_lessons(self, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
        """根据查询关键词搜索相关经验。

        使用简单的关键词匹配进行搜索（完整语义搜索由 Manager 层协调）。
        """
        all_records = await self._repo.search_by_category(self._category)

        # 简单关键词过滤
        results: list[dict[str, Any]] = []
        query_lower = query.lower()
        for r in all_records:
            if query_lower in r.content.lower():
                results.append({
                    'id': r.id,
                    'content': r.content,
                    'tags': r.metadata_json,
                    'created_at': r.created_at.isoformat(),
                })
            if len(results) >= limit:
                break

        return results

    async def forget(self, lesson_id: str) -> bool:
        """删除一条经验记录。"""
        return await self._repo.delete(lesson_id)
