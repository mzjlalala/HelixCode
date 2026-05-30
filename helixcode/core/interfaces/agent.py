"""Agent pipeline contracts — state, nodes, and orchestrator."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


class AgentState(dict):
    """Mutable state bag passed through the LangGraph pipeline.

    This is a plain dict subclass so it works seamlessly with LangGraph's
    TypedDict-based state management. Keys are documented here for clarity:

    - ``task``: str — Original user request
    - ``command``: str — Which command: explain | review | search | plan | fix
    - ``messages``: list[dict[str, str]] — Conversation history
    - ``plan``: list[dict[str, Any]] | None — Planner output
    - ``search_results``: list[dict[str, Any]] | None — Searcher output
    - ``analysis``: dict[str, Any] | None — Analyzer output
    - ``diffs``: list[dict[str, Any]] | None — Executor output
    - ``review``: dict[str, Any] | None — Reviewer output
    - ``final_result``: str | None — Formatted result for the user
    - ``errors``: list[str] — Accumulated errors
    """


@runtime_checkable
class AgentNode(Protocol):
    """A single processing unit in the agent graph."""

    name: str

    async def execute(self, state: AgentState) -> AgentState:
        """Process *state* and return the (possibly mutated) result."""
        ...


@runtime_checkable
class AgentOrchestrator(Protocol):
    """Builds and runs the full LangGraph agent pipeline."""

    async def run(
        self,
        task: str,
        *,
        command: str | None = None,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute the agent pipeline and return the final result dict.

        The returned dict contains at minimum a ``final_result`` key with
        a human-readable string, plus any command-specific output keys.
        """
        ...
