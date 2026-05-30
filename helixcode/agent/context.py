"""Agent 上下文 — 注入到每个节点的依赖集合。

将所有外部依赖集中到一个 dataclass 中，实现构造函数注入。
"""

from __future__ import annotations

from dataclasses import dataclass

from helixcode.core.interfaces.code_index import CodeSearcher
from helixcode.core.interfaces.llm import ChatProvider
from helixcode.core.interfaces.mcp import MCPToolRegistry
from helixcode.core.interfaces.memory import (
    LongTermMemory,
    RepositoryMemory,
    SessionMemory,
)
from helixcode.tools.ast_parser import ASTParser
from helixcode.tools.git_utils import GitUtils


@dataclass
class AgentContext:
    """Agent 节点所需的全部外部依赖。

    每个字段都是一个抽象接口（Protocol/ABC），
    具体实现在 CLI bootstrap 阶段由 DI 容器注入。
    """

    chat_provider: ChatProvider
    code_searcher: CodeSearcher | None = None
    session_memory: SessionMemory | None = None
    repository_memory: RepositoryMemory | None = None
    long_term_memory: LongTermMemory | None = None
    tool_registry: MCPToolRegistry | None = None
    ast_parser: ASTParser | None = None
    git_utils: GitUtils | None = None
