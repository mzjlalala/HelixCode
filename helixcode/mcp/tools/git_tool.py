"""Git 操作工具 — 状态、差异、日志、分支管理。"""

from __future__ import annotations

from typing import Any

from helixcode.mcp.tools.base import BaseTool
from helixcode.mcp.types import ToolCallResult


class GitStatusTool(BaseTool):
    """查看 git 状态。"""

    name = 'git_status'
    description = '查看当前工作目录的 git 状态（已修改、已暂存、未跟踪的文件）。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'project_root': {'type': 'string', 'description': '项目根目录'},
            },
            'required': [],
        }

    async def execute(self, project_root: str = '.') -> ToolCallResult:
        try:
            from helixcode.tools.git_utils import GitUtils
            git = GitUtils(project_root)
            repo = git.get_repo()
            status = repo.git.status()
            return ToolCallResult(success=True, data=status)
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))


class GitDiffTool(BaseTool):
    """查看 git 差异。"""

    name = 'git_diff'
    description = '获取当前工作目录的 git diff（可指定只看已暂存的变更）。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'project_root': {'type': 'string', 'description': '项目根目录'},
                'staged_only': {'type': 'boolean', 'description': '是否只看已暂存的变更'},
            },
            'required': [],
        }

    async def execute(
        self, project_root: str = '.', staged_only: bool = False
    ) -> ToolCallResult:
        try:
            from helixcode.tools.git_utils import GitUtils
            git = GitUtils(project_root)
            diff = git.get_diff(staged_only=staged_only)
            return ToolCallResult(success=True, data=diff or '无差异')
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))


class GitLogTool(BaseTool):
    """查看 git 提交日志。"""

    name = 'git_log'
    description = '查看最近的 git 提交记录。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'project_root': {'type': 'string', 'description': '项目根目录'},
                'max_count': {'type': 'integer', 'description': '最多显示的提交数'},
                'author': {'type': 'string', 'description': '按作者筛选'},
            },
            'required': [],
        }

    async def execute(
        self,
        project_root: str = '.',
        max_count: int = 10,
        author: str | None = None,
    ) -> ToolCallResult:
        try:
            from helixcode.tools.git_utils import GitUtils
            git = GitUtils(project_root)
            log = git.get_log(max_count=max_count, author=author)
            return ToolCallResult(success=True, data=log)
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))


class GitBranchTool(BaseTool):
    """查看和切换 git 分支。"""

    name = 'git_branch'
    description = '列出所有分支或显示当前分支。'

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            'type': 'object',
            'properties': {
                'project_root': {'type': 'string', 'description': '项目根目录'},
            },
            'required': [],
        }

    async def execute(self, project_root: str = '.') -> ToolCallResult:
        try:
            from helixcode.tools.git_utils import GitUtils
            git = GitUtils(project_root)
            repo = git.get_repo()
            branches = [b.name for b in repo.branches]
            active = repo.active_branch.name
            return ToolCallResult(
                success=True,
                data={'active': active, 'branches': branches},
            )
        except Exception as exc:
            return ToolCallResult(success=False, error=str(exc))
