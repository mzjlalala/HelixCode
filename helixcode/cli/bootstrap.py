"""DI 容器启动引导 — 连接所有模块依赖。

将配置文件中的参数转换为具体的实例，
按依赖顺序构建所有服务，最终返回 AgentOrchestrator。
"""

from __future__ import annotations

from helixcode.agent.context import AgentContext
from helixcode.agent.orchestrator import AgentOrchestrator
from helixcode.config import Settings
from helixcode.llm.client_factory import create_openai_client
from helixcode.llm.openai_chat_provider import OpenAIChatProvider
from helixcode.llm.openai_embedding_provider import OpenAIEmbeddingProvider
from helixcode.logging import setup_logging


async def create_orchestrator(
    settings: Settings, project_root: str = '.'
) -> AgentOrchestrator:
    """构建完整的依赖注入树，返回可用的 AgentOrchestrator。

    构建顺序：
    1. 日志
    2. LLM 客户端 → ChatProvider + EmbeddingProvider
    3. 其他服务（RAG、Memory、MCP 等，按需初始化）
    4. AgentContext → AgentOrchestrator
    """
    setup_logging(settings.log_level)

    # LLM 层
    client = create_openai_client(settings.llm)
    chat_provider = OpenAIChatProvider(client, settings.llm)
    embedding_provider = OpenAIEmbeddingProvider(client, settings.llm)

    # 目前 Phase 1: 仅注入必需的依赖
    # 后续模块（RAG、MCP、Memory）在这里集成
    context = AgentContext(
        chat_provider=chat_provider,
        # 以下服务在后续阶段接入:
        code_searcher=None,
        session_memory=None,
        repository_memory=None,
        long_term_memory=None,
        tool_registry=None,
        ast_parser=None,
        git_utils=None,
    )

    return AgentOrchestrator(context)
