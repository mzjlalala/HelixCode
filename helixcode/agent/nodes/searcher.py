"""Searcher 节点 — 语义搜索代码库，定位相关文件和符号。

结合 RAG 流水线的语义搜索和关键词搜索，
为后续的 Analyzer 和 Executor 节点提供代码上下文。
"""

from __future__ import annotations

from helixcode.agent.context import AgentContext
from helixcode.agent.state import AgentState


class SearcherNode:
    """代码搜索节点，通过语义检索查找相关代码。"""

    name = 'searcher'

    def __init__(self, context: AgentContext) -> None:
        self._searcher = context.code_searcher

    async def execute(self, state: AgentState) -> AgentState:
        """根据任务和执行计划搜索相关代码。"""
        from rich.console import Console
        Console().print('  [dim]🔍 Searcher 正在搜索代码库...[/]')
        task = state.get('task', '')
        plan = state.get('plan', [])

        # 构建搜索查询：任务 + 计划步骤标题
        plan_titles = ' '.join(
            step.get('title', '') for step in (plan or [])
        )
        query = f'{task} {plan_titles}'.strip()

        if self._searcher is None:
            state['search_results'] = []
            state['messages'] = state.get('messages', []) + [
                {'role': 'searcher', 'content': '无搜索引擎可用'}
            ]
            return state

        try:
            results = await self._searcher.search(query, top_k=20)
            state['search_results'] = [
                {
                    'file_path': r.file_path,
                    'symbol_name': r.symbol_name,
                    'symbol_kind': r.symbol_kind,
                    'start_line': r.start_line,
                    'end_line': r.end_line,
                    'score': r.relevance_score,
                    'snippet': r.snippet,
                }
                for r in results
            ]
            state['messages'] = state.get('messages', []) + [
                {
                    'role': 'searcher',
                    'content': f'找到 {len(results)} 个相关结果',
                }
            ]
        except Exception as exc:
            state['errors'] = state.get('errors', []) + [f'Searcher 错误: {exc}']
            state['search_results'] = []

        return state
