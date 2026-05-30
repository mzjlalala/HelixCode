"""Agent 编排器 — 对外的统一入口。

构建 LangGraph 流水线，管理状态初始化和最终结果的返回。
"""

from __future__ import annotations

from typing import Any

from helixcode.agent.context import AgentContext
from helixcode.agent.graph import build_agent_graph
from helixcode.agent.state import AgentState


class AgentOrchestrator:
    """Agent 流水线编排器，封装了整个 LangGraph 的执行流程。

    Usage::

        orchestrator = AgentOrchestrator(context)
        result = await orchestrator.run('修复订单超时', command='fix')
        print(result['final_result'])
    """

    def __init__(self, context: AgentContext) -> None:
        self._context = context
        self._graph = build_agent_graph(context)

    async def run(
        self,
        task: str,
        *,
        command: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """执行 Agent 流水线并返回最终结果。

        Args:
            task: 用户请求文本
            command: 命令类型 (explain|review|search|plan|fix)
            context: 额外的上下文信息（如 Memory 注入的上下文）

        Returns:
            包含 final_result 和中间输出的完整结果字典。
        """
        # 初始化状态
        initial_state: AgentState = {
            'task': task,
            'command': command or 'explain',
            'messages': [],
            'plan': None,
            'search_results': None,
            'analysis': None,
            'diffs': None,
            'review': None,
            'final_result': None,
            'errors': [],
        }

        # 注入额外上下文
        if context:
            for key, value in context.items():
                if key == 'conversation':
                    initial_state['messages'] = list(value)
                elif key == 'plan':
                    initial_state['plan'] = value
                elif key in ('analysis', 'diffs', 'review'):
                    initial_state[key] = value

        # 执行 LangGraph 流水线
        final_state = await self._graph.ainvoke(initial_state)

        return {
            'task': task,
            'command': initial_state['command'],
            'plan': final_state.get('plan'),
            'search_results': final_state.get('search_results'),
            'analysis': final_state.get('analysis'),
            'diffs': final_state.get('diffs'),
            'review': final_state.get('review'),
            'final_result': final_state.get(
                'final_result', '无法完成请求'
            ),
            'errors': final_state.get('errors', []),
            'success': len(final_state.get('errors', [])) == 0,
        }
