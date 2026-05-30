"""helix plan "<task>" — 生成任务执行计划。"""

from __future__ import annotations

import asyncio
import concurrent.futures

from helixcode.cli.display import console, display_error, display_plan
from helixcode.cli.utils import load_settings, validate_api_key


async def _run_plan(task: str, project_root: str | None) -> None:
    settings = load_settings(project_root)
    validate_api_key(settings)

    from helixcode.cli.bootstrap import create_orchestrator

    console.print(f'\n📋 正在为 [bold cyan]{task}[/] 生成执行计划 ...\n')

    orchestrator = await create_orchestrator(settings, project_root or '.')
    result = await orchestrator.run(task, command='plan')

    if result.get('errors'):
        for err in result['errors']:
            display_error(err)
        return

    plan_steps = result.get('plan', [])
    display_plan(plan_steps)


def _run_async(coro):
    """安全地运行异步协程，兼容已有事件循环的场景。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(coro)
    else:
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pool.submit(asyncio.run, coro).result()


def plan(task: str, project_root: str | None = None) -> None:
    """为任务生成结构化的执行计划。

    Agent 会按 Controller → Service → Repository → DTO → Test
    的层次自动拆解任务。

    示例:
        helix plan "增加导出功能"
    """
    try:
        _run_async(_run_plan(task, project_root))
    except Exception as exc:
        display_error(str(exc))
