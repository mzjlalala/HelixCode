"""helix review — 审查当前 git 变更。"""

from __future__ import annotations

import asyncio
import concurrent.futures

from helixcode.cli.display import console, display_error, display_review
from helixcode.cli.utils import load_settings, validate_api_key


async def _run_review(
    staged_only: bool = False, project_root: str | None = None
) -> None:
    settings = load_settings(project_root)
    validate_api_key(settings)

    from helixcode.cli.bootstrap import create_orchestrator

    mode_text = '已暂存的' if staged_only else '所有'
    console.print(f'\n🔎 正在审查{mode_text}代码变更 ...\n')

    orchestrator = await create_orchestrator(settings, project_root or '.')
    result = await orchestrator.run(
        f'审查{mode_text}代码变更',
        command='review',
    )

    if result.get('errors'):
        for err in result['errors']:
            display_error(err)
        return

    review_data = result.get('review', {})
    problems = review_data.get('problems', [])

    diffs = result.get('diffs', [])
    if diffs and not problems:
        for d in diffs:
            if isinstance(d, dict) and 'severity' in d:
                problems.append(d)
            elif isinstance(d, dict):
                problems.append({
                    'severity': 'SUGGESTION',
                    'file_path': d.get('file_path', ''),
                    'line': d.get('start_line'),
                    'message': d.get('description', ''),
                })

    display_review(problems)


def _run_async(coro):
    """安全地运行异步协程，兼容已有事件循环的场景。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(coro)
    else:
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pool.submit(asyncio.run, coro).result()


def review(
    staged: bool = False, project_root: str | None = None
) -> None:
    """审查当前 git 变更。

    示例:
        helix review
        helix review --staged
    """
    try:
        _run_async(_run_review(staged, project_root))
    except Exception as exc:
        display_error(str(exc))
