"""helix explain <target> — 分析目标代码的调用链和功能。"""

from __future__ import annotations

import asyncio

from helixcode.cli.display import console, display_explanation, display_error
from helixcode.cli.utils import load_settings, validate_api_key


async def _run_explain(target: str, project_root: str | None) -> None:
    settings = load_settings(project_root)
    validate_api_key(settings)

    from helixcode.cli.bootstrap import create_orchestrator

    console.print(f'\n🔍 正在分析 [bold cyan]{target}[/] ...\n')

    orchestrator = await create_orchestrator(settings, project_root or '.')
    result = await orchestrator.run(
        f'分析 {target} 的代码结构、调用链和功能',
        command='explain',
    )

    if result.get('errors'):
        for err in result['errors']:
            display_error(err)
        return

    analysis = result.get('analysis', {})
    display_explanation(analysis)


def explain(target: str, project_root: str | None = None) -> None:
    """分析目标代码的调用链和功能。

    示例:
        helix explain OrderService
        helix explain src/services/order.py --project-root /path/to/project
    """
    asyncio.run(_run_explain(target, project_root))
