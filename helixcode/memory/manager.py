"""记忆管理器 — 统一协调三层记忆系统。

MemoryManager 是记忆系统对外的唯一入口，负责：
1. 汇聚 Session / Repository / LongTerm 三层记忆
2. 为 Agent 注入上下文（augment_context）
3. 在 Agent 执行后更新记忆
"""

from __future__ import annotations

from typing import Any

from helixcode.core.interfaces.memory import (
    LongTermMemory,
    RepositoryMemory,
    SessionMemory,
)
from helixcode.memory.extractor import MemoryExtractor


class MemoryManager:
    """统一记忆管理器，协调三层记忆。

    用法::

        manager = MemoryManager(session, repo, ltm)
        context = await manager.augment_context('修复订单超时')
        # ... agent 执行 ...
        await manager.update_from_result(agent_result)
    """

    def __init__(
        self,
        session: SessionMemory,
        repository: RepositoryMemory,
        long_term: LongTermMemory,
    ) -> None:
        self._session = session
        self._repository = repository
        self._long_term = long_term

    async def augment_context(self, task: str) -> dict[str, Any]:
        """根据任务查询所有记忆层，返回聚合的上下文。

        查询优先级：
        1. 会话记忆（最近的对话上下文）
        2. 仓库记忆（项目技术栈、结构等）
        3. 长期记忆（跨项目的经验教训）

        Returns:
            聚合后的上下文字典，可直接传入 Agent。
        """
        context: dict[str, Any] = {
            'conversation': self._session.get_conversation(),
            'task': task,
        }

        # 仓库记忆：获取项目技术栈信息
        tech = await self._repository.recall('tech_stack')
        if tech:
            context['tech_stack'] = tech

        # 长期记忆：搜索相关经验
        lessons = await self._long_term.find_lessons(task, limit=5)
        if lessons:
            context['related_lessons'] = lessons

        return context

    async def update_from_result(self, agent_result: dict[str, Any]) -> None:
        """Agent 执行完成后更新记忆。

        - 将会话消息写入 Session Memory
        - 提取经验写入 LongTerm Memory
        - 提取项目信息写入 Repository Memory

        Args:
            agent_result: AgentOrchestrator.run() 的完整返回结果
        """
        # 记录对话
        task = agent_result.get('task', '')
        self._session.add_message('user', task)
        result_text = agent_result.get('final_result', '')
        if result_text:
            self._session.add_message('assistant', result_text)

        # 提取长期经验
        lessons = MemoryExtractor.extract_lessons(agent_result)
        for lesson in lessons:
            tags = lesson['tags'].split(',')
            await self._long_term.record_lesson(
                lesson['content'], tags=tags
            )

        # 提取项目信息
        repo_info = MemoryExtractor.extract_repo_info(agent_result)
        for key, value in repo_info.items():
            await self._repository.remember(key, value)
