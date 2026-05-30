"""MemoryManager 的测试。"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from helixcode.memory.manager import MemoryManager


@pytest.fixture
def mock_session():
    """模拟 SessionMemory。"""
    from helixcode.memory.session import InMemorySession
    return InMemorySession()


@pytest.fixture
def mock_repo_memory():
    """模拟 RepositoryMemory。"""
    mock = AsyncMock()
    mock.recall = AsyncMock(return_value=None)
    mock.remember = AsyncMock()
    mock.recall_category = AsyncMock(return_value=[])
    return mock


@pytest.fixture
def mock_long_term():
    """模拟 LongTermMemory。"""
    mock = AsyncMock()
    mock.find_lessons = AsyncMock(return_value=[])
    mock.record_lesson = AsyncMock(return_value='lesson-1')
    mock.forget = AsyncMock(return_value=True)
    return mock


class TestMemoryManager:
    @pytest.mark.asyncio
    async def test_augment_context_basic(
        self, mock_session, mock_repo_memory, mock_long_term
    ) -> None:
        manager = MemoryManager(
            mock_session, mock_repo_memory, mock_long_term
        )
        mock_session.add_message('user', '之前的对话')

        context = await manager.augment_context('修复订单超时')

        assert context['task'] == '修复订单超时'
        assert len(context['conversation']) == 1
        assert context['conversation'][0]['content'] == '之前的对话'

    @pytest.mark.asyncio
    async def test_augment_context_with_repo_info(
        self, mock_session, mock_repo_memory, mock_long_term
    ) -> None:
        mock_repo_memory.recall = AsyncMock(return_value='Python 3.13')

        manager = MemoryManager(
            mock_session, mock_repo_memory, mock_long_term
        )
        context = await manager.augment_context('test')
        assert context['tech_stack'] == 'Python 3.13'

    @pytest.mark.asyncio
    async def test_augment_context_with_lessons(
        self, mock_session, mock_repo_memory, mock_long_term
    ) -> None:
        mock_long_term.find_lessons = AsyncMock(
            return_value=[{'id': '1', 'content': '上一次修复类似bug的方案'}]
        )
        manager = MemoryManager(
            mock_session, mock_repo_memory, mock_long_term
        )
        context = await manager.augment_context('修复超时')
        assert len(context['related_lessons']) == 1

    @pytest.mark.asyncio
    async def test_update_from_result(
        self, mock_session, mock_repo_memory, mock_long_term
    ) -> None:
        manager = MemoryManager(
            mock_session, mock_repo_memory, mock_long_term
        )
        result = {
            'task': '修复订单超时',
            'final_result': '已修复，原因是数据库连接池耗尽。',
            'success': True,
            'diffs': [{'file_path': 'db.py'}],
        }

        await manager.update_from_result(result)

        # 会话中应该记录了对话
        conv = mock_session.get_conversation()
        assert len(conv) == 2  # user + assistant

        # 长期记忆中应该记录了修复方案
        mock_long_term.record_lesson.assert_called()
