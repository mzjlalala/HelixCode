"""Agent 节点的单元测试。

使用 Mock ChatProvider 避免真实的 API 调用。
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from helixcode.agent.context import AgentContext
from helixcode.agent.nodes.analyzer import AnalyzerNode
from helixcode.agent.nodes.executor import ExecutorNode
from helixcode.agent.nodes.planner import PlannerNode
from helixcode.agent.nodes.reviewer import ReviewerNode
from helixcode.agent.nodes.searcher import SearcherNode
from helixcode.agent.state import AgentState


@pytest.fixture
def mock_chat() -> AsyncMock:
    """返回一个模拟的 ChatProvider。"""
    chat = AsyncMock()
    # 默认返回一个最小的 JSON 响应
    chat.chat = AsyncMock(return_value='{"summary": "测试分析结果"}')
    return chat


@pytest.fixture
def context(mock_chat) -> AgentContext:
    return AgentContext(chat_provider=mock_chat)


def _make_state(command: str, task: str = '测试任务') -> AgentState:
    return AgentState(
        task=task,
        command=command,
        messages=[],
        plan=None,
        search_results=None,
        analysis=None,
        diffs=None,
        review=None,
        final_result=None,
        errors=[],
    )


class TestPlannerNode:
    @pytest.mark.asyncio
    async def test_plan_generation(self, context) -> None:
        context.chat_provider.chat = AsyncMock(
            return_value='{"steps": [{"step_number": 1, "title": "测试步骤"}], "estimated_complexity": "low", "rationale": "简单"}'
        )
        node = PlannerNode(context)
        state = _make_state('plan')
        result = await node.execute(state)
        assert len(result['plan']) == 1
        assert result['plan'][0]['title'] == '测试步骤'

    @pytest.mark.asyncio
    async def test_plan_json_in_code_block(self, context) -> None:
        """测试 JSON 在 markdown 代码块中的情况。"""
        context.chat_provider.chat = AsyncMock(
            return_value='```json\n{"steps": [{"step_number": 1, "title": "A"}], "rationale": "ok"}\n```'
        )
        node = PlannerNode(context)
        state = _make_state('plan')
        result = await node.execute(state)
        assert len(result['plan']) == 1

    @pytest.mark.asyncio
    async def test_plan_parse_error_graceful(self, context) -> None:
        """无法解析的响应不会导致崩溃。"""
        context.chat_provider.chat = AsyncMock(
            return_value='一些非 JSON 的文本回复'
        )
        node = PlannerNode(context)
        state = _make_state('plan')
        result = await node.execute(state)
        assert result['plan'] == []


class TestSearcherNode:
    @pytest.mark.asyncio
    async def test_no_searcher_available(self, context) -> None:
        node = SearcherNode(context)
        state = _make_state('search')
        result = await node.execute(state)
        assert result['search_results'] == []


class TestAnalyzerNode:
    @pytest.mark.asyncio
    async def test_analysis_generation(self, context) -> None:
        context.chat_provider.chat = AsyncMock(
            return_value='{"summary": "代码分析完成"}'
        )
        node = AnalyzerNode(context)
        state = _make_state('explain')
        result = await node.execute(state)
        assert result['analysis']['summary'] == '代码分析完成'


class TestExecutorNode:
    @pytest.mark.asyncio
    async def test_diff_generation(self, context) -> None:
        context.chat_provider.chat = AsyncMock(
            return_value='[{"file_path": "test.py", "description": "修复", "original_lines": "old", "modified_lines": "new", "start_line": 1, "end_line": 1}]'
        )
        node = ExecutorNode(context)
        state = _make_state('fix')
        result = await node.execute(state)
        assert len(result['diffs']) == 1
        assert result['diffs'][0]['file_path'] == 'test.py'


class TestReviewerNode:
    @pytest.mark.asyncio
    async def test_review_with_errors(self, context) -> None:
        node = ReviewerNode(context)
        state = _make_state('fix')
        state['errors'] = ['之前有错误']
        result = await node.execute(state)
        assert result['review']['approved'] is False
        assert '错误' in result['final_result']

    @pytest.mark.asyncio
    async def test_review_format_for_review_command(self, context) -> None:
        context.chat_provider.chat = AsyncMock(
            return_value='{"approved": true, "summary": "通过", "problems": [], "score": 9}'
        )
        node = ReviewerNode(context)
        state = _make_state('review')
        result = await node.execute(state)
        assert '审查通过' in result['final_result']

    @pytest.mark.asyncio
    async def test_review_format_for_plan_command(self, context) -> None:
        context.chat_provider.chat = AsyncMock(
            return_value='{"approved": true, "summary": "ok", "problems": [], "score": 8}'
        )
        node = ReviewerNode(context)
        state = _make_state('plan')
        state['plan'] = [
            {'step_number': 1, 'title': '步骤1', 'description': '描述1', 'dependencies': []}
        ]
        result = await node.execute(state)
        assert '步骤1' in result['final_result']
