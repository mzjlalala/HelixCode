"""helix fix "<problem>" — 分析问题并生成修复 diff。"""

from __future__ import annotations

import asyncio

from helixcode.cli.display import console, display_diff, display_error
from helixcode.cli.utils import load_settings, validate_api_key


async def _run_fix(problem: str, project_root: str | None) -> None:
    settings = load_settings(project_root)
    validate_api_key(settings)

    from helixcode.cli.bootstrap import create_orchestrator

    console.print(f'\n🔧 正在分析并修复: [bold cyan]{problem}[/] ...\n')

    orchestrator = await create_orchestrator(settings, project_root or '.')
    result = await orchestrator.run(
        f'修复: {problem}',
        command='fix',
    )

    if result.get('errors'):
        for err in result['errors']:
            display_error(err)
        return

    diffs = result.get('diffs', [])
    display_diff(diffs)

    # 询问用户是否应用变更
    if diffs:
        console.print(
            '\n[dim]以上为 AI 生成的修复方案，请审查后手动应用。[/]'
        )


def fix(problem: str, project_root: str | None = None) -> None:
    """分析问题并生成修复 diff（不直接覆盖文件）。

    示例:
        helix fix "修复订单超时问题"
        helix fix "add input validation to login"
    """
    asyncio.run(_run_fix(problem, project_root))
