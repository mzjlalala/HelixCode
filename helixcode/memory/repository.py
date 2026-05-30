"""仓库记忆 — 项目级别的持久化记忆。

存储当前项目的技术栈、目录结构、数据库信息、中间件信息等。
数据持久化到 SQLite，并通过 RAG 的语义搜索增强查询能力。
"""

from __future__ import annotations

from pathlib import Path

from helixcode.core.interfaces.memory import RepositoryMemory
from helixcode.storage.memory_repository import MemoryRecordRepository


class RepoMemory(RepositoryMemory):
    """项目级别记忆，基于 SQLite 持久化 + RAG 语义搜索增强。

    存储的内容包括：
    - 技术栈（语言、框架、库）
    - 项目目录结构
    - 数据库连接信息
    - 中间件配置
    - 代码规范和约定
    """

    def __init__(self, repo: MemoryRecordRepository) -> None:
        self._repo = repo
        self._category = 'repository'

    async def remember(self, key: str, value: str, category: str = 'general') -> None:
        """存储一条项目相关的事实。

        Args:
            key: 事实的键（如 'tech_stack'）
            value: 事实的值（如 'Python 3.13, FastAPI'）
            category: 分类标签
        """
        from helixcode.storage.models import MemoryRecord
        record = MemoryRecord(
            content=f'{key}: {value}',
            category=f'{self._category}:{category}',
        )
        await self._repo.add(record)

    async def recall(self, key: str) -> str | None:
        """根据键查找记忆。"""
        records = await self._repo.search_by_category(f'{self._category}:{key}')
        if records:
            return records[0].content
        return None

    async def recall_category(self, category: str) -> list[dict[str, str]]:
        """返回某个分类下的所有记忆。"""
        records = await self._repo.search_by_category(
            f'{self._category}:{category}'
        )
        return [
            {'key': r.metadata_json, 'content': r.content}
            for r in records
        ]

    async def update_repository_info(self, project_root: Path) -> None:
        """扫描项目根目录，自动收集项目信息。

        检测：
        - Python 项目的 pyproject.toml / requirements.txt
        - Node.js 项目的 package.json
        - Go 项目的 go.mod
        - Rust 项目的 Cargo.toml
        """
        # 检测 Python
        if (project_root / 'pyproject.toml').exists():
            await self.remember('build_system', 'hatchling/poetry/setuptools', 'tech')
        elif (project_root / 'requirements.txt').exists():
            await self.remember('build_system', 'pip', 'tech')

        # 检测前端
        if (project_root / 'package.json').exists():
            await self.remember('runtime', 'Node.js', 'tech')

        # 检测 Go
        if (project_root / 'go.mod').exists():
            await self.remember('language', 'Go', 'tech')

        # 检测 Rust
        if (project_root / 'Cargo.toml').exists():
            await self.remember('language', 'Rust', 'tech')

        # 记录项目结构快照
        from helixcode.tools.file_utils import get_project_structure
        structure = get_project_structure(project_root, max_depth=3)
        await self.remember(
            'project_structure',
            str(structure),
            'structure',
        )
