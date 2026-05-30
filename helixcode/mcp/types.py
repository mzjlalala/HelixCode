"""MCP JSON-RPC 消息类型定义。

遵循 Model Context Protocol 规范，使用 Pydantic 做序列化和校验。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class JSONRPCRequest(BaseModel):
    """JSON-RPC 2.0 请求。"""

    jsonrpc: str = '2.0'
    id: int | str
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


class JSONRPCResponse(BaseModel):
    """JSON-RPC 2.0 响应。"""

    jsonrpc: str = '2.0'
    id: int | str
    result: Any = None


class JSONRPCError(BaseModel):
    """JSON-RPC 2.0 错误响应。"""

    jsonrpc: str = '2.0'
    id: int | str | None = None
    error: dict[str, Any]


class ToolDefinition(BaseModel):
    """工具的元数据定义（名称、描述、参数 schema）。"""

    name: str
    description: str = ''
    parameters: dict[str, Any] = Field(default_factory=dict)


class ToolCallRequest(BaseModel):
    """客户端请求调用某个工具。"""

    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolCallResult(BaseModel):
    """工具执行的结果。"""

    success: bool
    data: Any = None
    error: str | None = None
