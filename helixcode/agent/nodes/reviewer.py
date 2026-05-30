"""Reviewer 节点 — 审查执行结果，作为最终质量门禁。

审查 Executor 的输出，确保：
- 代码变更的正确性
- 无安全漏洞
- 遵循编码规范
- 评分和审批
"""

from __future__ import annotations

import json

from helixcode.agent.context import AgentContext
from helixcode.agent.prompts.reviewer_prompt import REVIEWER_SYSTEM_PROMPT
from helixcode.agent.state import AgentState


class ReviewerNode:
    """代码审查节点，验证其他节点的输出质量。"""

    name = 'reviewer'

    def __init__(self, context: AgentContext) -> None:
        self._chat = context.chat_provider

    async def execute(self, state: AgentState) -> AgentState:
        """审查流水线的输出，生成质量报告。"""
        command = state.get('command', '')
        diffs = state.get('diffs', [])
        analysis = state.get('analysis', {})
        errors = state.get('errors', [])

        # 如果之前有错误，直接标记审查失败
        if errors:
            state['review'] = {
                'approved': False,
                'summary': f'执行过程中出现错误: {"; ".join(errors)}',
                'score': 0,
                'problems': [],
            }
            state['final_result'] = state['review']['summary']
            return state

        # 构建审查输入
        review_input = self._build_review_input(command, diffs, analysis)

        try:
            response = await self._chat.chat(
                [{'role': 'user', 'content': review_input}],
                system=REVIEWER_SYSTEM_PROMPT,
                temperature=0.2,
            )

            review = self._parse_response(response)
            state['review'] = review
            state['messages'] = state.get('messages', []) + [
                {'role': 'reviewer', 'content': json.dumps(review, ensure_ascii=False)}
            ]

            # 生成最终结果
            state['final_result'] = self._format_final(state, review)

        except Exception as exc:
            state['errors'] = state.get('errors', []) + [f'Reviewer 错误: {exc}']
            state['review'] = {'approved': False, 'summary': f'审查失败: {exc}'}
            state['final_result'] = f'审查失败: {exc}'

        return state

    def _build_review_input(
        self, command: str, diffs: list[dict], analysis: dict
    ) -> str:
        """构建审查时的输入文本。"""
        parts = [f'命令类型: {command}']

        if diffs:
            parts.append(f'\n代码变更（共 {len(diffs)} 处）:')
            for i, diff in enumerate(diffs):
                parts.append(
                    f"\n变更 {i + 1}: {diff.get('file_path', '未知文件')}\n"
                    f"说明: {diff.get('description', '无')}\n"
                    f"原代码:\n```\n{diff.get('original_lines', '')[:300]}\n```\n"
                    f"新代码:\n```\n{diff.get('modified_lines', '')[:300]}\n```"
                )

        if analysis:
            summary = analysis.get('summary', '')
            if summary:
                parts.append(f'\n分析摘要: {summary}')

        return '\n'.join(parts)

    def _parse_response(self, response: str) -> dict:
        """从 LLM 响应中解析审查结果。"""
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

        return {
            'approved': True,
            'summary': response[:500],
            'score': 7,
            'problems': [],
        }

    def _format_final(self, state: AgentState, review: dict) -> str:
        """根据审查结果生成最终用户可见的输出。"""
        command = state.get('command', '')

        if command == 'review':
            problems = review.get('problems', [])
            if not problems:
                return '✅ 代码审查通过，未发现问题。'

            lines = ['## 代码审查结果\n']
            crit = [p for p in problems if p.get('severity') == 'CRITICAL']
            warn = [p for p in problems if p.get('severity') == 'WARNING']
            sugg = [p for p in problems if p.get('severity') == 'SUGGESTION']

            if crit:
                lines.append(f'🔴 CRITICAL ({len(crit)}):')
                for p in crit:
                    lines.append(f'  - [{p.get("file_path", "")}:{p.get("line", "")}] {p.get("message", "")}')
            if warn:
                lines.append(f'🟡 WARNING ({len(warn)}):')
                for p in warn:
                    lines.append(f'  - [{p.get("file_path", "")}:{p.get("line", "")}] {p.get("message", "")}')
            if sugg:
                lines.append(f'🔵 SUGGESTION ({len(sugg)}):')
                for p in sugg:
                    lines.append(f'  - [{p.get("file_path", "")}:{p.get("line", "")}] {p.get("message", "")}')

            return '\n'.join(lines)

        if command == 'explain':
            analysis = state.get('analysis', {})
            summary = analysis.get('summary', '无分析结果')
            return f'## 代码分析\n\n{summary}'

        if command == 'fix':
            diffs = state.get('diffs', [])
            if not diffs:
                return '未生成代码变更。'
            lines = [f'## 代码修复方案（共 {len(diffs)} 处变更）\n']
            for d in diffs:
                lines.append(
                    f"### {d.get('file_path', '')}\n"
                    f"{d.get('description', '')}\n"
                )
            return '\n'.join(lines)

        if command == 'plan':
            plan = state.get('plan', [])
            if not plan:
                return '未生成执行计划。'
            lines = ['## 执行计划\n']
            for step in plan:
                deps = step.get('dependencies', [])
                dep_text = f' (依赖步骤: {deps})' if deps else ''
                lines.append(
                    f"{step.get('step_number', '?')}. "
                    f"**{step.get('title', '')}**{dep_text}\n"
                    f"   {step.get('description', '')}\n"
                )
            return '\n'.join(lines)

        # search
        results = state.get('search_results', [])
        if not results:
            return '未找到相关代码。'
        lines = [f'## 搜索结果（共 {len(results)} 条）\n']
        for r in results[:10]:
            lines.append(
                f"- `{r.get('file_path', '')}:{r.get('start_line', '')}` "
                f"**{r.get('symbol_name', '')}** "
                f"(相关性: {r.get('score', 0):.2f})\n"
            )
        return '\n'.join(lines)
