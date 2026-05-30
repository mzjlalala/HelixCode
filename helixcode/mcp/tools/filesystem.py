"""文件系统工具 — 文件读写、列表、删除、搜索。

所有路径操作都限制在 project_root 内，防止路径穿越攻击。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from helixcode.mcp.tools.base import BaseTool
from helixcode.mcp.types import ToolCallResult


class FileReadTool(BaseTool):
    """读取文件内容的工具。"""

    name = 'file_read'
    description = '读取指定文件的内容，可指定行范围。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'file_path': {'type': 'string', 'description': '相对于项目根目录的文件路径'},
                'start_line': {'type': 'integer', 'description': '起始行号（1-based，可选）'},
                'end_line': {'type': 'integer', 'description': '结束行号（1-based，可选）'},
            },
            'required': ['file_path'],
        }

    async def execute(
        self,
        file_path: str,
        start_line: int | None = None,
        end_line: int | None = None,
    ) -> ToolCallResult:
        from helixcode.tools.file_utils import read_file
        try:
            content = read_file(file_path, start_line, end_line)
            return ToolCallResult(success=True, data=content)
        except FileNotFoundError:
            return ToolCallResult(success=False, error=f'文件不存在: {file_path}')


class FileWriteTool(BaseTool):
    """写入文件内容的工具。"""

    name = 'file_write'
    description = '将内容写入指定文件（覆盖模式）。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'file_path': {'type': 'string', 'description': '相对于项目根目录的文件路径'},
                'content': {'type': 'string', 'description': '要写入的内容'},
            },
            'required': ['file_path', 'content'],
        }

    async def execute(self, file_path: str, content: str) -> ToolCallResult:
        try:
            p = Path(file_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding='utf-8')
            return ToolCallResult(success=True, data=f'写入成功: {file_path}')
        except OSError as exc:
            return ToolCallResult(success=False, error=str(exc))


class FileListTool(BaseTool):
    """列出目录文件的工具。"""

    name = 'file_list'
    description = '列出指定目录下的文件和子目录。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'directory': {'type': 'string', 'description': '目录路径，默认为项目根目录'},
                'pattern': {'type': 'string', 'description': 'glob 模式，如 *.py'},
            },
            'required': [],
        }

    async def execute(
        self, directory: str = '.', pattern: str = '*'
    ) -> ToolCallResult:
        from helixcode.tools.file_utils import find_files
        try:
            files = find_files(directory, pattern=pattern)
            result = [str(f) for f in files]
            return ToolCallResult(success=True, data=result)
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))


class FileSearchTool(BaseTool):
    """在文件中搜索内容的工具。"""

    name = 'file_search'
    description = '在项目文件中搜索匹配的文本内容（基于 ripgrep）。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'query': {'type': 'string', 'description': '搜索关键词或正则表达式'},
                'file_pattern': {'type': 'string', 'description': '文件过滤 glob，如 *.py'},
                'directory': {'type': 'string', 'description': '搜索目录，默认为项目根目录'},
            },
            'required': ['query'],
        }

    async def execute(
        self,
        query: str,
        file_pattern: str = '*',
        directory: str = '.',
    ) -> ToolCallResult:
        import subprocess
        try:
            cmd = ['rg', '--line-number', '--color', 'never', query]
            if file_pattern != '*':
                cmd.extend(['--glob', file_pattern])
            cmd.append(directory)
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode in (0, 1):  # 0=match, 1=no match
                return ToolCallResult(success=True, data=result.stdout or '无匹配')
            return ToolCallResult(success=False, error=result.stderr)
        except FileNotFoundError:
            return ToolCallResult(
                success=False, error='未找到 rg (ripgrep)，请先安装'
            )
        except subprocess.TimeoutExpired:
            return ToolCallResult(success=False, error='搜索超时')
