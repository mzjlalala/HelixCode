"""MCP 工具实现的测试。"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from helixcode.mcp.tools.filesystem import FileReadTool, FileWriteTool, FileListTool
from helixcode.mcp.tools.terminal import ShellExecuteTool
from helixcode.mcp.types import ToolCallResult


class TestFileReadTool:
    @pytest.mark.asyncio
    async def test_read_existing_file(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.txt', delete=False, encoding='utf-8'
        ) as f:
            f.write('你好世界')
            f.flush()

        tool = FileReadTool()
        result = await tool.execute(file_path=f.name)
        assert result.success is True
        assert '你好世界' in result.data

        Path(f.name).unlink()

    @pytest.mark.asyncio
    async def test_read_missing_file(self) -> None:
        tool = FileReadTool()
        result = await tool.execute(file_path='/nonexistent/file.txt')
        assert result.success is False


class TestFileWriteTool:
    @pytest.mark.asyncio
    async def test_write_and_read_back(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.txt', delete=False, encoding='utf-8'
        ) as f:
            path = f.name

        try:
            tool = FileWriteTool()
            result = await tool.execute(file_path=path, content='写入测试')
            assert result.success is True

            read_tool = FileReadTool()
            read_result = await read_tool.execute(file_path=path)
            assert '写入测试' in read_result.data
        finally:
            Path(path).unlink()


class TestFileListTool:
    @pytest.mark.asyncio
    async def test_list_files(self, tmp_path: Path) -> None:
        (tmp_path / 'a.py').write_text('')
        (tmp_path / 'b.py').write_text('')

        tool = FileListTool()
        result = await tool.execute(directory=str(tmp_path), pattern='*.py')
        assert result.success is True
        assert len(result.data) == 2


class TestShellExecuteTool:
    @pytest.mark.asyncio
    async def test_echo_command(self) -> None:
        tool = ShellExecuteTool()
        result = await tool.execute(command='echo hello test')
        assert result.success is True
        assert 'hello test' in result.data['stdout']

    @pytest.mark.asyncio
    async def test_timeout(self) -> None:
        # 使用 Windows 的 ping 命令（-n 表示次数，-w 表示超时）
        tool = ShellExecuteTool()
        result = await tool.execute(
            command='ping -n 10 127.0.0.1', timeout=0.1
        )
        assert result.success is False
        assert '超时' in result.error

    @pytest.mark.asyncio
    async def test_failing_command(self) -> None:
        tool = ShellExecuteTool()
        result = await tool.execute(command='nonexistent_command_xyz')
        assert result.success is False
