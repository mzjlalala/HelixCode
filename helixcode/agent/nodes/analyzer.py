"""Analyzer 节点 — 分析代码结构、调用链和依赖关系。

使用 AST 解析器和 LLM 生成结构化的代码分析报告。
对于 explain 命令，生成目标符号的调用链和功能说明。
"""

from __future__ import annotations

import json

from helixcode.agent.context import AgentContext
from helixcode.agent.prompts.analyzer_prompt import ANALYZER_SYSTEM_PROMPT
from helixcode.agent.state import AgentState


class AnalyzerNode:
    """代码分析节点，构建调用链和依赖分析。"""

    name = 'analyzer'

    def __init__(self, context: AgentContext) -> None:
        self._chat = context.chat_provider
        self._ast_parser = context.ast_parser

    async def execute(self, state: AgentState) -> AgentState:
        """分析搜索结果，生成结构化的代码分析报告。"""
        task = state.get('task', '')
        search_results = state.get('search_results', [])
        command = state.get('command', '')

        # 构建分析输入
        context_text = self._build_context(task, search_results, command)

        try:
            response = await self._chat.chat(
                [{'role': 'user', 'content': context_text}],
                system=ANALYZER_SYSTEM_PROMPT,
                temperature=0.3,
            )

            analysis = self._parse_response(response)
            state['analysis'] = analysis
            state['messages'] = state.get('messages', []) + [
                {'role': 'analyzer', 'content': json.dumps(analysis, ensure_ascii=False)}
            ]

        except Exception as exc:
            state['errors'] = state.get('errors', []) + [f'Analyzer 错误: {exc}']
            state['analysis'] = {'summary': f'分析失败: {exc}'}

        return state

    def _build_context(
        self, task: str, search_results: list[dict], command: str
    ) -> str:
        """构建发送给 LLM 的分析上下文。"""
        parts = [f'分析任务: {task}']

        if command == 'explain':
            parts.append('请重点分析目标代码的调用链和功能。')

        if search_results:
            parts.append('\n搜索到的相关代码:')
            for i, r in enumerate(search_results[:10]):  # 限制上下文长度
                parts.append(
                    f'\n--- 结果 {i + 1} ---\n'
                    f'文件: {r["file_path"]}\n'
                    f'符号: {r["symbol_name"]} ({r["symbol_kind"]})\n'
                    f'位置: 第{r["start_line"]}-{r["end_line"]}行\n'
                    f'代码片段:\n{r["snippet"][:500]}'
                )

        return '\n'.join(parts)

    def _parse_response(self, response: str) -> dict:
        """从 LLM 响应中解析 JSON 分析结果。"""
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        import re
        match = re.search(r'```(?:json)?\s*([\s\S]*?)```', response)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        return {'summary': response[:500]}
