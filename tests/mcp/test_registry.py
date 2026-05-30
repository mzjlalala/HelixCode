"""ToolRegistry 的测试。"""

from __future__ import annotations

import pytest

from helixcode.mcp.registry import ToolRegistry
from helixcode.mcp.tools.base import BaseTool
from helixcode.mcp.types import ToolCallResult


class _EchoTool(BaseTool):
    """测试用工具：回显输入。"""
    name = 'echo'
    description = '回显输入参数'

    async def execute(self, message: str = 'hello') -> ToolCallResult:
        return ToolCallResult(success=True, data=message)


class _FailingTool(BaseTool):
    """测试用工具：总是失败。"""
    name = 'fail'
    description = '总是失败'

    async def execute(self) -> ToolCallResult:
        return ToolCallResult(success=False, error='故意的错误')


class TestToolRegistry:
    def test_register_and_get(self) -> None:
        registry = ToolRegistry()
        tool = _EchoTool()
        registry.register(tool)
        assert registry.get('echo') is tool

    def test_get_missing_returns_none(self) -> None:
        registry = ToolRegistry()
        assert registry.get('不存在') is None

    def test_list_tools(self) -> None:
        registry = ToolRegistry()
        registry.register(_EchoTool())
        registry.register(_FailingTool())

        tools = registry.list_tools()
        assert len(tools) == 2
        names = {t['name'] for t in tools}
        assert names == {'echo', 'fail'}

    @pytest.mark.asyncio
    async def test_execute_success(self) -> None:
        registry = ToolRegistry()
        registry.register(_EchoTool())

        result = await registry.execute('echo', message='hi')
        assert result.success is True
        assert result.data == 'hi'

    @pytest.mark.asyncio
    async def test_execute_failure(self) -> None:
        registry = ToolRegistry()
        registry.register(_FailingTool())

        result = await registry.execute('fail')
        assert result.success is False
        assert '错误' in result.error

    @pytest.mark.asyncio
    async def test_execute_unknown_tool(self) -> None:
        registry = ToolRegistry()
        result = await registry.execute('不存在')
        assert result.success is False
