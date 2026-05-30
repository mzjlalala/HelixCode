"""AgentOrchestrator 的测试。"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from helixcode.agent.context import AgentContext
from helixcode.agent.orchestrator import AgentOrchestrator


@pytest.fixture
def mock_chat() -> AsyncMock:
    chat = AsyncMock()
    chat.chat = AsyncMock(return_value='{"summary": "ok", "approved": true, "problems": [], "score": 8}')
    return chat


@pytest.fixture
def context(mock_chat) -> AgentContext:
    return AgentContext(chat_provider=mock_chat)


class TestAgentOrchestrator:
    @pytest.mark.asyncio
    async def test_run_explain(self, context) -> None:
        orchestrator = AgentOrchestrator(context)
        result = await orchestrator.run('分析 OrderService', command='explain')
        assert 'final_result' in result
        assert result['command'] == 'explain'

    @pytest.mark.asyncio
    async def test_run_review(self, context) -> None:
        orchestrator = AgentOrchestrator(context)
        result = await orchestrator.run('审查代码', command='review')
        assert 'final_result' in result
        # review 命令直接走 executor，然后 reviewer
        assert result['command'] == 'review'

    @pytest.mark.asyncio
    async def test_run_with_context(self, context) -> None:
        orchestrator = AgentOrchestrator(context)
        result = await orchestrator.run(
            'test',
            command='explain',
            context={'conversation': [{'role': 'user', 'content': 'hi'}]},
        )
        assert 'final_result' in result

    @pytest.mark.asyncio
    async def test_run_search(self, context) -> None:
        orchestrator = AgentOrchestrator(context)
        result = await orchestrator.run('搜索订单', command='search')
        assert result['command'] == 'search'
