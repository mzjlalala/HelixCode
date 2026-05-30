"""会话记忆 — 纯内存存储，每次对话独立。

存储对话历史、临时上下文、Agent 状态快照等会话级别信息。
会话结束后数据自动释放。
"""

from __future__ import annotations

from typing import Any

from helixcode.core.interfaces.memory import SessionMemory


class InMemorySession(SessionMemory):
    """基于 dict 的会话记忆实现。

    每次 CLI 调用创建一个新实例，调用结束后自动释放。
    """

    def __init__(self) -> None:
        self._messages: list[dict[str, str]] = []
        self._context: dict[str, Any] = {}

    def add_message(self, role: str, content: str) -> None:
        """追加一条对话记录。"""
        self._messages.append({'role': role, 'content': content})

    def get_conversation(self) -> list[dict[str, str]]:
        """返回完整对话历史。"""
        return list(self._messages)

    def set_context(self, key: str, value: Any) -> None:
        """存储任意键值对作为会话上下文。"""
        self._context[key] = value

    def get_context(self, key: str) -> Any | None:
        """获取之前的上下文值，不存在时返回 None。"""
        return self._context.get(key)

    def clear(self) -> None:
        """清空所有会话状态。"""
        self._messages.clear()
        self._context.clear()
