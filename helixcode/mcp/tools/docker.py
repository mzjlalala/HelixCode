"""Docker 工具 — 容器管理、执行命令、查看日志。"""

from __future__ import annotations

import asyncio
from typing import Any

from helixcode.mcp.tools.base import BaseTool
from helixcode.mcp.types import ToolCallResult


class DockerRunTool(BaseTool):
    """运行 Docker 容器。"""

    name = 'docker_run'
    description = '运行一个新的 Docker 容器。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'image': {'type': 'string', 'description': 'Docker 镜像名称'},
                'command': {'type': 'string', 'description': '容器启动命令（可选）'},
                'detach': {'type': 'boolean', 'description': '是否后台运行'},
            },
            'required': ['image'],
        }

    async def execute(
        self,
        image: str,
        command: str | None = None,
        detach: bool = True,
    ) -> ToolCallResult:
        try:
            cmd = ['docker', 'run']
            if detach:
                cmd.append('-d')
            cmd.append(image)
            if command:
                cmd.append(command)

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            return ToolCallResult(
                success=proc.returncode == 0,
                data=stdout.decode('utf-8', errors='replace').strip(),
                error=stderr.decode('utf-8', errors='replace').strip() or None,
            )
        except FileNotFoundError:
            return ToolCallResult(
                success=False, error='未找到 docker 命令，请确认 Docker 已安装'
            )
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))


class DockerExecTool(BaseTool):
    """在运行中的容器内执行命令。"""

    name = 'docker_exec'
    description = '在正在运行的 Docker 容器中执行命令。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'container_id': {'type': 'string', 'description': '容器 ID 或名称'},
                'command': {'type': 'string', 'description': '要执行的命令'},
            },
            'required': ['container_id', 'command'],
        }

    async def execute(
        self, container_id: str, command: str
    ) -> ToolCallResult:
        try:
            proc = await asyncio.create_subprocess_exec(
                'docker', 'exec', container_id, command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            return ToolCallResult(
                success=proc.returncode == 0,
                data=stdout.decode('utf-8', errors='replace').strip(),
                error=stderr.decode('utf-8', errors='replace').strip() or None,
            )
        except FileNotFoundError:
            return ToolCallResult(
                success=False, error='未找到 docker 命令'
            )
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))


class DockerListTool(BaseTool):
    """列出 Docker 容器。"""

    name = 'docker_list'
    description = '列出 Docker 容器（默认只显示运行中的）。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'all': {'type': 'boolean', 'description': '是否列出所有容器（包括已停止的）'},
            },
            'required': [],
        }

    async def execute(self, all: bool = False) -> ToolCallResult:
        try:
            cmd = ['docker', 'ps']
            if all:
                cmd.append('-a')
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            return ToolCallResult(
                success=proc.returncode == 0,
                data=stdout.decode('utf-8', errors='replace').strip(),
                error=stderr.decode('utf-8', errors='replace').strip() or None,
            )
        except FileNotFoundError:
            return ToolCallResult(
                success=False, error='未找到 docker 命令'
            )
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))


class DockerLogsTool(BaseTool):
    """查看容器日志。"""

    name = 'docker_logs'
    description = '查看指定 Docker 容器的日志。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'container_id': {'type': 'string', 'description': '容器 ID 或名称'},
                'tail': {'type': 'integer', 'description': '显示最后 N 行日志'},
            },
            'required': ['container_id'],
        }

    async def execute(
        self, container_id: str, tail: int = 100
    ) -> ToolCallResult:
        try:
            cmd = ['docker', 'logs', '--tail', str(tail), container_id]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            return ToolCallResult(
                success=proc.returncode == 0,
                data=stdout.decode('utf-8', errors='replace').strip(),
                error=stderr.decode('utf-8', errors='replace').strip() or None,
            )
        except FileNotFoundError:
            return ToolCallResult(
                success=False, error='未找到 docker 命令'
            )
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))
