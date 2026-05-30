"""CLI 输出格式化 — 基于 Rich 的美化输出。

为每条命令提供差异化的格式化方案，包括表格、面板、代码高亮等。
"""

from __future__ import annotations

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.syntax import Syntax
from rich.markdown import Markdown

console = Console()


def display_explanation(analysis: dict) -> None:
    """格式化显示代码分析结果（explain 命令）。"""
    summary = analysis.get('summary', '无分析结果')
    console.print(Panel(Markdown(summary), title='[bold cyan]代码分析[/]'))

    call_chain = analysis.get('call_chain', [])
    if call_chain:
        table = Table(title='调用链', show_header=True)
        table.add_column('调用者', style='green')
        table.add_column('被调用者', style='yellow')
        table.add_column('关系')
        for cc in call_chain:
            table.add_row(
                cc.get('caller', ''),
                cc.get('callee', ''),
                cc.get('relationship', ''),
            )
        console.print(table)


def display_review(problems: list[dict]) -> None:
    """格式化显示代码审查结果（review 命令）。

    按严重级别分组，用颜色区分：
    - CRITICAL: 红色
    - WARNING: 黄色
    - SUGGESTION: 蓝色
    """
    if not problems:
        console.print('[green]✅ 代码审查通过，未发现问题。[/]')
        return

    crit = [p for p in problems if p.get('severity') == 'CRITICAL']
    warn = [p for p in problems if p.get('severity') == 'WARNING']
    sugg = [p for p in problems if p.get('severity') == 'SUGGESTION']

    console.print()

    if crit:
        for p in crit:
            console.print(
                Panel(
                    p.get('message', ''),
                    title=f'[bold red]🔴 CRITICAL[/] - {p.get("file_path", "")}:{p.get("line", "")}',
                    subtitle=p.get('suggestion', ''),
                    border_style='red',
                )
            )

    if warn:
        for p in warn:
            console.print(
                Panel(
                    p.get('message', ''),
                    title=f'[bold yellow]🟡 WARNING[/] - {p.get("file_path", "")}:{p.get("line", "")}',
                    subtitle=p.get('suggestion', ''),
                    border_style='yellow',
                )
            )

    if sugg:
        for p in sugg:
            console.print(
                Panel(
                    p.get('message', ''),
                    title=f'[bold blue]🔵 SUGGESTION[/] - {p.get("file_path", "")}:{p.get("line", "")}',
                    subtitle=p.get('suggestion', ''),
                    border_style='blue',
                )
            )

    console.print(f'\n共发现 [red]{len(crit)} 严重[/]、[yellow]{len(warn)} 警告[/]、[blue]{len(sugg)} 建议[/]')


def display_search_results(results: list[dict]) -> None:
    """格式化显示搜索结果（search 命令）。"""
    if not results:
        console.print('[yellow]未找到相关代码。[/]')
        return

    table = Table(title='搜索结果', show_header=True)
    table.add_column('文件', style='cyan', no_wrap=True)
    table.add_column('符号', style='green')
    table.add_column('行号')
    table.add_column('相关性', justify='right')

    for r in results[:20]:
        score = r.get('score', r.get('relevance_score', 0))
        table.add_row(
            r.get('file_path', ''),
            r.get('symbol_name', ''),
            str(r.get('start_line', '')),
            f'{score:.2f}',
        )

    console.print(table)
    console.print(f'\n共 {len(results)} 条结果')


def display_plan(plan_steps: list[dict]) -> None:
    """格式化显示执行计划（plan 命令）。"""
    if not plan_steps:
        console.print('[yellow]未生成执行计划。[/]')
        return

    console.print(Panel('[bold]执行计划[/]', border_style='cyan'))

    for step in plan_steps:
        deps = step.get('dependencies', [])
        dep_text = f' [dim](依赖: {deps})[/]' if deps else ''
        console.print(
            f'\n[bold cyan]{step.get("step_number", "?")}.[/] '
            f'[bold]{step.get("title", "")}[/]{dep_text}'
        )
        desc = step.get('description', '')
        if desc:
            console.print(f'   {desc}')
        target = step.get('target_file', '')
        if target:
            console.print(f'   📄 [dim]{target}[/]')
        layer = step.get('layer', '')
        if layer:
            console.print(f'   🏷️  [dim]{layer}[/]')

    console.print()


def display_diff(diffs: list[dict]) -> None:
    """格式化显示代码变更 diff（fix 命令）。"""
    if not diffs:
        console.print('[yellow]未生成代码变更。[/]')
        return

    for d in diffs:
        console.print(
            Panel(
                d.get('description', '变更说明'),
                title=f'[bold]📄 {d.get("file_path", "")}[/]',
                border_style='green',
            )
        )
        original = d.get('original_lines', '')
        modified = d.get('modified_lines', '')
        if original or modified:
            console.print('[dim]修改前:[/]')
            console.print(Syntax(original, 'python', theme='monokai'))
            console.print('[dim]修改后:[/]')
            console.print(Syntax(modified, 'python', theme='monokai'))


def display_error(message: str) -> None:
    """格式化显示错误信息。"""
    console.print(f'\n[bold red]错误:[/] {message}\n')
