"""Executor 节点 — 生成代码变更（diff），绝不直接写入文件。

对于 fix 命令：生成修复 diff
对于 review 命令：生成问题列表
对于 plan 命令：生成实现 diff
"""

from __future__ import annotations

import json

from helixcode.agent.context import AgentContext
from helixcode.agent.prompts.executor_prompt import EXECUTOR_SYSTEM_PROMPT
from helixcode.agent.state import AgentState


class ExecutorNode:
    """代码执行节点，根据计划和分析生成代码变更。"""

    name = 'executor'

    def __init__(self, context: AgentContext) -> None:
        self._chat = context.chat_provider
        self._git_utils = context.git_utils

    async def execute(self, state: AgentState) -> AgentState:
        """根据计划和上下文生成代码变更。"""
        task = state.get('task', '')
        command = state.get('command', '')
        plan = state.get('plan', [])
        analysis = state.get('analysis', {})

        # 构建执行上下文
        context_text = self._build_context(task, command, plan, analysis)

        if command == 'review':
            # review 命令：需要获取 git diff
            git_diff = ''
            if self._git_utils:
                try:
                    git_diff = self._git_utils.get_diff()
                except Exception:
                    pass
            context_text += f'\n\n当前 git diff:\n```\n{git_diff}\n```'

        try:
            response = await self._chat.chat(
                [{'role': 'user', 'content': context_text}],
                system=EXECUTOR_SYSTEM_PROMPT,
                temperature=0.2,  # 代码生成需要更精确
            )

            diffs = self._parse_response(response, command)
            state['diffs'] = diffs
            state['messages'] = state.get('messages', []) + [
                {'role': 'executor', 'content': json.dumps(diffs, ensure_ascii=False)}
            ]

        except Exception as exc:
            state['errors'] = state.get('errors', []) + [f'Executor 错误: {exc}']
            state['diffs'] = []

        return state

    def _build_context(
        self,
        task: str,
        command: str,
        plan: list[dict],
        analysis: dict,
    ) -> str:
        """构建执行上下文字符串。"""
        parts = [f'任务: {task}', f'命令类型: {command}']

        if plan:
            parts.append('\n执行计划:')
            for step in plan:
                parts.append(
                    f"  {step.get('step_number', '?')}. "
                    f"{step.get('title', '')}: {step.get('description', '')}"
                )

        if analysis:
            parts.append(f"\n代码分析结果:\n{json.dumps(analysis, ensure_ascii=False, indent=2)}")

        return '\n'.join(parts)

    def _parse_response(self, response: str, command: str) -> list[dict]:
        """从 LLM 响应中解析代码变更列表。"""
        try:
            data = json.loads(response)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and 'diffs' in data:
                return data['diffs']
            return [data]
        except json.JSONDecodeError:
            pass

        import re
        match = re.search(r'```(?:json)?\s*([\s\S]*?)```', response)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        return [{'description': response[:500]}]
