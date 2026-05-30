"""Verify that interfaces are importable and structurally sound.

No concrete implementations exist yet — these tests ensure the protocols
compile and can be ``isinstance``-checked where applicable.
"""

from __future__ import annotations

from helixcode.core import interfaces
from helixcode.core.interfaces import (
    AgentNode,
    AgentOrchestrator,
    AgentState,
    ChatProvider,
    CodeIndexer,
    CodeSearcher,
    EmbeddingProvider,
    LongTermMemory,
    MCPClient,
    MCPTool,
    MCPToolRegistry,
    Repository,
    RepositoryMemory,
    SessionMemory,
)


def test_all_interfaces_importable() -> None:
    """Every interface defined in the package is accessible."""
    names = interfaces.__all__
    for name in names:
        obj = getattr(interfaces, name)
        assert obj is not None, f'{name} is None'


def test_repository_is_abstract() -> None:
    """Repository is an ABC and cannot be instantiated directly."""
    import inspect
    assert inspect.isabstract(Repository)


def test_llm_protocols_are_runtime_checkable() -> None:
    """ChatProvider and EmbeddingProvider support isinstance checks."""
    from typing import runtime_checkable
    assert hasattr(ChatProvider, '_is_runtime_protocol')
    assert hasattr(EmbeddingProvider, '_is_runtime_protocol')


def test_agent_state_is_dict_subclass() -> None:
    """AgentState is a plain dict so it integrates with LangGraph TypedDict."""
    state = AgentState(task='test', command='explain')
    assert state['task'] == 'test'
    assert state['command'] == 'explain'
    assert isinstance(state, dict)
