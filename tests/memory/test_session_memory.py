"""InMemorySession 的测试。"""

from __future__ import annotations

from helixcode.memory.session import InMemorySession


class TestInMemorySession:
    def test_add_and_get_messages(self) -> None:
        session = InMemorySession()
        session.add_message('user', '你好')
        session.add_message('assistant', '你好，有什么可以帮你？')

        conv = session.get_conversation()
        assert len(conv) == 2
        assert conv[0]['role'] == 'user'
        assert conv[1]['role'] == 'assistant'

    def test_set_and_get_context(self) -> None:
        session = InMemorySession()
        session.set_context('project_root', '/test/project')
        assert session.get_context('project_root') == '/test/project'

    def test_get_missing_context(self) -> None:
        session = InMemorySession()
        assert session.get_context('不存在') is None

    def test_clear_resets_all(self) -> None:
        session = InMemorySession()
        session.add_message('user', 'hi')
        session.set_context('key', 'value')

        session.clear()
        assert len(session.get_conversation()) == 0
        assert session.get_context('key') is None

    def test_conversation_returns_copy(self) -> None:
        """get_conversation 返回的是副本，修改不影响内部状态。"""
        session = InMemorySession()
        session.add_message('user', 'hi')

        conv = session.get_conversation()
        conv.pop()

        assert len(session.get_conversation()) == 1  # 内部状态未变
