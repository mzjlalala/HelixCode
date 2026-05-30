"""记忆提取器 — 从 Agent 交互中自动提取值得记忆的信息。

在 Agent 执行完毕后调用，分析执行结果并提取：
- 成功方案
- 失败的教训
- 用户显式反馈
"""

from __future__ import annotations

from typing import Any


class MemoryExtractor:
    """从 Agent 的执行结果中提取值得长期记忆的信息。

    分析规则：
    - 用户说"记住..." → 直接存储
    - 修复成功 → 记录修复模式
    - 用户纠正 → 记录偏好
    """

    @staticmethod
    def extract_lessons(agent_result: dict[str, Any]) -> list[dict[str, str]]:
        """从 Agent 执行结果中提取经验列表。

        Args:
            agent_result: AgentOrchestrator.run() 返回的完整结果字典

        Returns:
            提取到的经验列表，每条包含 content 和 tags。
        """
        lessons: list[dict[str, str]] = []

        # 用户直接要求记住的内容
        if 'explicit_memory' in agent_result:
            lessons.append({
                'content': agent_result['explicit_memory'],
                'tags': 'user_request',
            })

        # 修复成功 → 记录方案
        if agent_result.get('diffs') and agent_result.get('success'):
            lessons.append({
                'content': f"修复成功: {agent_result.get('task', '')}",
                'tags': 'fix,success',
            })

        # 审查发现严重问题
        if agent_result.get('review') and agent_result.get('review', {}).get('critical_count', 0) > 0:
            lessons.append({
                'content': (
                    f"代码审查发现 {agent_result['review']['critical_count']} 个严重问题: "
                    f"{agent_result.get('task', '')}"
                ),
                'tags': 'review,critical',
            })

        return lessons

    @staticmethod
    def extract_repo_info(agent_result: dict[str, Any]) -> dict[str, str]:
        """从 Agent 交互中提取项目级别信息。

        Returns:
            键值对字典，如 {'tech_stack': 'Python 3.13, FastAPI'}
        """
        info: dict[str, str] = {}
        context = agent_result.get('context', {})

        if 'repo_info' in context:
            info.update(context['repo_info'])

        return info
