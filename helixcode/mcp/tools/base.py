"""MCP 工具的抽象基类。

每个具体工具继承 BaseTool，实现 execute 方法。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from helixcode.mcp.types import ToolCallResult, ToolDefinition


class BaseTool(ABC):
    """MCP 工具基类，子类需提供 name、description、parameters 和 execute 方法。"""

    name: str = ''
    description: str = ''

    @property
    def definition(self) -> ToolDefinition:
        """生成工具的元数据定义。"""
        return ToolDefinition(
            name=self.name,
            description=self.description,
            parameters=self.parameters,
        )

    @property
    def parameters(self) -> dict[str, Any]:
        """返回 JSON Schema 格式的参数定义，子类可重写。"""
        return {}

    @abstractmethod
    async def execute(self, **kwargs: Any) -> ToolCallResult:
        """执行工具并返回结果。"""
        ...
