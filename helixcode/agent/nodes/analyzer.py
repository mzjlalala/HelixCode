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
        from rich.console import Console
        Console().print('  [dim]📊 Analyzer 正在分析代码...[/]')
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
        """构建发送给 LLM 的分析上下文。

        当搜索结果为空时，尝试通过任务描述中的目标名直接查找文件。
        """
        parts = [f'分析任务: {task}']

        if command == 'explain':
            parts.append('请重点分析目标代码的调用链和功能。')

        if search_results:
            parts.append('\n搜索到的相关代码:')
            for i, r in enumerate(search_results[:10]):
                parts.append(
                    f'\n--- 结果 {i + 1} ---\n'
                    f'文件: {r["file_path"]}\n'
                    f'符号: {r["symbol_name"]} ({r["symbol_kind"]})\n'
                    f'位置: 第{r["start_line"]}-{r["end_line"]}行\n'
                    f'代码片段:\n{r["snippet"][:500]}'
                )
        else:
            # 没有搜索结果时，尝试直接查找文件
            found_content = self._try_read_target_file(task)
            if found_content:
                parts.append(f'\n目标文件内容:\n```\n{found_content[:3000]}\n```')
            else:
                parts.append(
                    '\n注意: 未能在项目目录中找到目标文件的代码。'
                    '\n请根据任务描述中的类名或文件名，给出分析建议。'
                )

        return '\n'.join(parts)

    def _try_read_target_file(self, task: str) -> str | None:
        """从任务描述中提取目标名，尝试在项目中查找并读取文件。

        支持类名（如 OrderService）和文件路径（如 src/main.py）。
        """
        import re
        from pathlib import Path

        # 尝试从任务中提取可能的文件名或类名
        # 格式: "分析 XXX 的..."  -> XXX 就是目标
        match = re.search(r'分析\s+(\S+)', task)
        if not match:
            return None

        target = match.group(1)
        cwd = Path.cwd()

        # 尝试多种查找方式
        candidates = [
            target,                          # 直接的路径
            f'{target}.java',                # Java 类
            f'{target}.py',                  # Python 文件
            f'src/**/{target}.java',         # src 下的 Java
            f'src/**/{target}.py',           # src 下的 Python
            f'**/{target}.java',
            f'**/{target}.py',
        ]

        for pattern in candidates:
            matches = list(cwd.glob(pattern))
            if matches:
                try:
                    return matches[0].read_text(encoding='utf-8', errors='replace')
                except Exception:
                    continue

        return None

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
