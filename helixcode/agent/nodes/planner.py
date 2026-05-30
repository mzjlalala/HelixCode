"""Planner 节点 — 将用户请求拆解为结构化的执行计划。

使用 LLM 分析任务并生成分步计划，尤其为 plan 命令生成
Controller → Service → Repository → DTO → Test 的完整分解。
"""

from __future__ import annotations

import json

from helixcode.agent.context import AgentContext
from helixcode.agent.prompts.planner_prompt import PLANNER_SYSTEM_PROMPT
from helixcode.agent.state import AgentState


class PlannerNode:
    """任务规划节点，将用户请求拆解为可执行步骤。"""

    name = 'planner'

    def __init__(self, context: AgentContext) -> None:
        self._chat = context.chat_provider

    async def execute(self, state: AgentState) -> AgentState:
        """分析任务并生成执行计划。"""
        from rich.console import Console
        console = Console()
        console.print('  [dim]🧠 Planner 正在拆解任务...[/]')

        task = state.get('task', '')
        command = state.get('command', '')

        # 为 plan 命令提供更详细的指引
        extra_guidance = ''
        if command == 'plan':
            extra_guidance = (
                '\n特别注意：这是一个 plan 命令，请按 '
                'Controller → Service → Repository → DTO → Test '
                '的层次拆解任务。'
            )

        user_message = f'任务：{task}{extra_guidance}'

        try:
            response = await self._chat.chat(
                [{'role': 'user', 'content': user_message}],
                system=PLANNER_SYSTEM_PROMPT,
                temperature=0.3,  # 低温度确保稳定输出
            )

            plan = self._parse_response(response)
            state['plan'] = plan.get('steps', [])
            state['messages'] = state.get('messages', []) + [
                {'role': 'planner', 'content': json.dumps(plan, ensure_ascii=False)}
            ]

        except Exception as exc:
            state['errors'] = state.get('errors', []) + [f'Planner 错误: {exc}']
            state['plan'] = []

        return state

    def _parse_response(self, response: str) -> dict:
        """从 LLM 响应中提取 JSON 计划。"""
        try:
            # 尝试直接解析整个响应
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 代码块
        import re
        match = re.search(r'```(?:json)?\s*([\s\S]*?)```', response)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # 返回基本结构
        return {'steps': [], 'rationale': '无法解析 LLM 输出'}
