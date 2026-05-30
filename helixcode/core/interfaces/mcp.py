"""Model Context Protocol (MCP) contracts."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


class MCPToolCallResult(Protocol):
    """Result returned by an MCP tool execution."""

    success: bool
    data: Any
    error: str | None


@runtime_checkable
class MCPTool(Protocol):
    """A single tool exposed via MCP."""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema

    async def execute(self, **kwargs: Any) -> MCPToolCallResult:
        """Run the tool with the given arguments."""
        ...


@runtime_checkable
class MCPToolRegistry(Protocol):
    """Registry that holds and dispatches to MCP tools."""

    def register(self, tool: MCPTool) -> None:
        """Add *tool* to the registry."""
        ...

    def get(self, name: str) -> MCPTool | None:
        """Look up a tool by name."""
        ...

    def list_tools(self) -> list[dict[str, Any]]:
        """Return tool definitions (name, description, parameters schema)."""
        ...

    async def execute(self, name: str, **kwargs: Any) -> MCPToolCallResult:
        """Look up and execute a tool in one call."""
        ...


@runtime_checkable
class MCPClient(Protocol):
    """Client that communicates with MCP servers."""

    async def connect(self, server_command: str) -> None:
        """Launch or attach to an MCP server."""
        ...

    async def discover_tools(self) -> list[dict[str, Any]]:
        """List tools available on the connected server."""
        ...

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Invoke *tool_name* and return the raw response."""
        ...

    async def disconnect(self) -> None:
        """Shut down the server connection."""
        ...
