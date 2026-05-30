"""终端工具 — 执行 shell 命令。"""

from __future__ import annotations

import asyncio
from typing import Any

from helixcode.mcp.tools.base import BaseTool
from helixcode.mcp.types import ToolCallResult


class ShellExecuteTool(BaseTool):
    """执行 shell 命令的工具，支持超时控制。"""

    name = 'shell_execute'
    description = '执行一条 shell 命令并返回 stdout/stderr，支持超时。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'command': {'type': 'string', 'description': '要执行的 shell 命令'},
                'timeout': {
                    'type': 'number',
                    'description': '超时时间（秒），默认 60',
                },
                'cwd': {'type': 'string', 'description': '工作目录，默认为当前目录'},
            },
            'required': ['command'],
        }

    async def execute(
        self,
        command: str,
        timeout: float = 60.0,
        cwd: str | None = None,
    ) -> ToolCallResult:
        try:
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
            return ToolCallResult(
                success=proc.returncode == 0,
                data={
                    'stdout': stdout.decode('utf-8', errors='replace'),
                    'stderr': stderr.decode('utf-8', errors='replace'),
                    'returncode': proc.returncode,
                },
            )
        except asyncio.TimeoutError:
            return ToolCallResult(
                success=False,
                error=f'命令执行超时（{timeout}s）: {command}',
            )
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))
