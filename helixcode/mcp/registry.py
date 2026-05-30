"""MCP 工具注册表。

管理所有工具实例，支持注册、查找、列出和调用。
"""

from __future__ import annotations

from helixcode.mcp.tools.base import BaseTool
from helixcode.mcp.types import ToolCallResult


class ToolRegistry:
    """工具注册表，以字典形式存储 name -> BaseTool 的映射。"""

    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        """注册一个工具。如果名字冲突则覆盖旧工具。"""
        self._tools[tool.name] = tool

    def get(self, name: str) -> BaseTool | None:
        """按名称查找工具，不存在返回 None。"""
        return self._tools.get(name)

    def list_tools(self) -> list[dict[str, object]]:
        """列出所有已注册工具的定义（名称、描述、参数 schema）。"""
        return [
            {
                'name': t.name,
                'description': t.description,
                'parameters': t.parameters,
            }
            for t in self._tools.values()
        ]

    async def execute(self, name: str, **kwargs: object) -> ToolCallResult:
        """查找并执行指定的工具。

        如果工具不存在，返回失败的 ToolCallResult。
        """
        tool = self.get(name)
        if tool is None:
            return ToolCallResult(
                success=False, error=f'未知工具: {name}'
            )
        return await tool.execute(**kwargs)
