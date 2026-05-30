"""helix search "<query>" — 语义搜索代码库。"""

from __future__ import annotations

import asyncio

from helixcode.cli.display import console, display_error, display_search_results
from helixcode.cli.utils import load_settings, validate_api_key


async def _run_search(query: str, project_root: str | None) -> None:
    settings = load_settings(project_root)
    validate_api_key(settings)

    from helixcode.cli.bootstrap import create_orchestrator

    console.print(f'\n🔍 搜索: [bold cyan]{query}[/] ...\n')

    orchestrator = await create_orchestrator(settings, project_root or '.')
    result = await orchestrator.run(
        f'搜索: {query}',
        command='search',
    )

    if result.get('errors'):
        for err in result['errors']:
            display_error(err)
        return

    search_results = result.get('search_results', [])
    display_search_results(search_results)


def search(query: str, project_root: str | None = None) -> None:
    """语义搜索代码库中的相关文件和符号。

    示例:
        helix search "订单超时"
        helix search "JWT authentication"
    """
    asyncio.run(_run_search(query, project_root))
