"""HelixCode CLI 入口 — AI Software Engineering Agent。

用法:
    helix explain <target>    分析代码调用链和功能
    helix review              审查 git 变更
    helix search "<query>"    语义搜索代码库
    helix plan "<task>"       生成任务执行计划
    helix fix "<problem>"     生成修复方案 diff
"""

from __future__ import annotations

import typer

from helixcode import __version__

app = typer.Typer(
    name='helix',
    help='AI Software Engineering Agent — 让 AI 理解、修改和审查你的代码。',
    no_args_is_help=True,
)

# 公共选项
_project_root_option = typer.Option(
    None, '--project-root', '-r',
    help='项目根目录路径（默认为当前目录）',
)


@app.command()
def explain(
    target: str = typer.Argument(..., help='要分析的目标符号或文件'),
    project_root: str | None = _project_root_option,
) -> None:
    """分析目标代码的调用链和功能。

    示例:
        helix explain OrderService
        helix explain src/services/order.py
    """
    from helixcode.cli.commands.explain import explain as _explain
    _explain(target, project_root)


@app.command()
def review(
    staged: bool = typer.Option(
        False, '--staged', '-s', help='只审查已暂存的变更'
    ),
    project_root: str | None = _project_root_option,
) -> None:
    """审查当前 git 变更，按严重级别分类显示问题。

    示例:
        helix review
        helix review --staged
    """
    from helixcode.cli.commands.review import review as _review
    _review(staged, project_root)


@app.command()
def search(
    query: str = typer.Argument(..., help='搜索关键词或自然语言查询'),
    project_root: str | None = _project_root_option,
) -> None:
    """语义搜索代码库中的相关文件和符号。

    示例:
        helix search "订单超时"
        helix search "JWT authentication"
    """
    from helixcode.cli.commands.search import search as _search
    _search(query, project_root)


@app.command()
def plan(
    task: str = typer.Argument(..., help='要拆解的任务描述'),
    project_root: str | None = _project_root_option,
) -> None:
    """为开发任务生成结构化的执行计划。

    Agent 按 Controller → Service → Repository → DTO → Test 层次拆解。

    示例:
        helix plan "增加导出功能"
    """
    from helixcode.cli.commands.plan import plan as _plan
    _plan(task, project_root)


@app.command()
def fix(
    problem: str = typer.Argument(..., help='要修复的问题描述'),
    project_root: str | None = _project_root_option,
) -> None:
    """分析问题并生成修复 diff（不直接覆盖文件）。

    示例:
        helix fix "修复订单超时问题"
    """
    from helixcode.cli.commands.fix import fix as _fix
    _fix(problem, project_root)


@app.callback(invoke_without_command=True)
def _version_callback(
    version: bool = typer.Option(
        False, '--version', '-v', help='显示版本号'
    ),
) -> None:
    if version:
        print(f'HelixCode v{__version__}')
        raise typer.Exit()


if __name__ == '__main__':
    app()
