"""HelixCode CLI 入口 — AI Software Engineering Agent。

直接输入 helix 进入交互式对话模式（推荐）。
也可以用子命令快速执行单个任务。
"""

from __future__ import annotations

import sys
from pathlib import Path

import typer

from helixcode import __version__

app = typer.Typer(
    name='helix',
    help='AI 代码助手 — 输入 helix 进入对话，或使用子命令快速执行任务。',
)

_project_root_option = typer.Option(
    None, '--project-root', '-r',
    help='项目根目录路径（默认为当前目录）',
)


def _run_async(coro):
    import asyncio
    import concurrent.futures
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(coro)
    else:
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pool.submit(asyncio.run, coro).result()


@app.command()
def chat(
    project_root: str | None = _project_root_option,
) -> None:
    """启动交互式对话模式（默认命令）。"""
    from helixcode.cli.utils import load_settings, validate_api_key
    from helixcode.core.exceptions import ConfigurationError

    settings = load_settings(project_root)
    try:
        validate_api_key(settings)
    except ConfigurationError as exc:
        from rich.console import Console
        Console().print(f'\n[bold red]配置错误:[/] {exc}')
        return

    from helixcode.llm.client_factory import create_openai_client
    from helixcode.llm.openai_chat_provider import OpenAIChatProvider
    from helixcode.logging import setup_logging
    setup_logging('ERROR')

    client = create_openai_client(settings.llm)
    chat_provider = OpenAIChatProvider(client, settings.llm)

    from helixcode.cli.chat import HelixChat
    helix = HelixChat(
        chat_provider=chat_provider,
        settings=settings,
        project_root=Path(project_root or '.').resolve(),
    )
    _run_async(helix.run())


@app.command()
def explain(
    target: str = typer.Argument(..., help='要分析的目标符号或文件'),
    project_root: str | None = _project_root_option,
) -> None:
    """分析目标代码的调用链和功能。"""
    from helixcode.cli.commands.explain import explain as _explain
    _explain(target, project_root)


@app.command()
def review(
    staged: bool = typer.Option(False, '--staged', '-s', help='只审查已暂存的变更'),
    project_root: str | None = _project_root_option,
) -> None:
    """审查当前 git 变更。"""
    from helixcode.cli.commands.review import review as _review
    _review(staged, project_root)


@app.command()
def search(
    query: str = typer.Argument(..., help='搜索关键词或自然语言查询'),
    project_root: str | None = _project_root_option,
) -> None:
    """语义搜索代码库。"""
    from helixcode.cli.commands.search import search as _search
    _search(query, project_root)


@app.command()
def plan(
    task: str = typer.Argument(..., help='要拆解的任务描述'),
    project_root: str | None = _project_root_option,
) -> None:
    """生成任务执行计划。"""
    from helixcode.cli.commands.plan import plan as _plan
    _plan(task, project_root)


@app.command()
def fix(
    problem: str = typer.Argument(..., help='要修复的问题描述'),
    project_root: str | None = _project_root_option,
) -> None:
    """分析问题并生成修复 diff。"""
    from helixcode.cli.commands.fix import fix as _fix
    _fix(problem, project_root)


def main():
    """入口：无参数时默认进入对话模式，--version 显示版本。"""
    if len(sys.argv) == 1:
        chat()
    elif sys.argv[1] in ('--version', '-v'):
        print(f'HelixCode v{__version__}')
    else:
        app()


if __name__ == '__main__':
    main()
